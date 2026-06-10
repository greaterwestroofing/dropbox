// server.js — Railway backend for SM8 Dropbox Addon
// Replaces attachment.php — fetches SM8 job attachments and uploads to Dropbox

const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;

// ─── ENV VARS (set these in Railway) ─────────────────────────────────────────
// DROPBOX_APP_KEY       — your Dropbox app key
// DROPBOX_APP_SECRET    — your Dropbox app secret
// DROPBOX_REFRESH_TOKEN — long-lived offline refresh token (see README)
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("SM8 Dropbox Addon OK"));

// ── Get a fresh Dropbox access token using the refresh token ─────────────────
async function getDropboxAccessToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", process.env.DROPBOX_REFRESH_TOKEN);
  params.append("client_id", process.env.DROPBOX_APP_KEY);
  params.append("client_secret", process.env.DROPBOX_APP_SECRET);

  const res = await axios.post("https://api.dropbox.com/oauth2/token", params);
  return res.data.access_token;
}

// ── Fetch all attachments for a SM8 job ─────────────────────────────────────
async function getSM8Attachments(jobId, smToken) {
  const res = await axios.get(
    `https://api.servicem8.com/api_1.0/attachment.json?%24filter=job_uuid%20eq%20'${jobId}'`,
    { headers: { Authorization: `Bearer ${smToken}` } }
  );
  return res.data || [];
}

// ── Fetch SM8 job details (for job number/name) ──────────────────────────────
async function getSM8Job(jobId, smToken) {
  const res = await axios.get(
    `https://api.servicem8.com/api_1.0/job/${jobId}.json`,
    { headers: { Authorization: `Bearer ${smToken}` } }
  );
  return res.data;
}

// ── Download a file from SM8 ─────────────────────────────────────────────────
async function downloadSM8File(fileUrl, smToken) {
  const res = await axios.get(fileUrl, {
    headers: { Authorization: `Bearer ${smToken}` },
    responseType: "arraybuffer",
  });
  return res.data;
}

// ── Upload a file to Dropbox ─────────────────────────────────────────────────
async function uploadToDropbox(dbxToken, folderPath, fileName, fileData) {
  const cleanName = fileName.replace(/[<>:"/\\|?*]/g, "_");
  const dropboxPath = `/${folderPath}/${cleanName}`;

  await axios.post(
    "https://content.dropboxapi.com/2/files/upload",
    fileData,
    {
      headers: {
        Authorization: `Bearer ${dbxToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: dropboxPath,
          mode: "overwrite",
          autorename: true,
          mute: false,
        }),
      },
    }
  );
  return dropboxPath;
}

// ── Create a shared Dropbox link for the folder ──────────────────────────────
async function getDropboxFolderLink(dbxToken, folderPath) {
  const path = `/${folderPath}`;
  try {
    // Try creating a share link
    const res = await axios.post(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      { path, settings: { requested_visibility: "public" } },
      {
        headers: {
          Authorization: `Bearer ${dbxToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data.url;
  } catch (err) {
    // If link already exists, retrieve it
    if (err.response?.data?.error?.[".tag"] === "shared_link_already_exists") {
      const existing = await axios.post(
        "https://api.dropboxapi.com/2/sharing/list_shared_links",
        { path, direct_only: true },
        {
          headers: {
            Authorization: `Bearer ${dbxToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      return existing.data.links?.[0]?.url || null;
    }
    throw err;
  }
}

// ── Sanitise a string for use as a Dropbox folder name ──────────────────────
function safeFolderName(str) {
  return (str || "Unknown Job")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
}

// ── Build a meaningful folder name from SM8 job data ────────────────────────
function buildFolderName(job) {
  const number = job.generated_job_id || job.uuid || "NoNumber";
  const name =
    job.job_address ||
    job.description ||
    `${job.contact_first || ""} ${job.contact_last || ""}`.trim() ||
    "Unnamed";
  return safeFolderName(`${number} - ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENDPOINT: GET /attachment
// Query params: jobid, token, imagecurrentindex, imagelastindex,
//               dropboxFolder (optional), download_link (optional)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/attachment", async (req, res) => {
  const { jobid, token, imagecurrentindex, imagelastindex, dropboxFolder, download_link } = req.query;

  if (!jobid || !token) {
    return res.status(400).json({ error: "Missing jobid or token" });
  }

  const currentIndex = parseInt(imagecurrentindex, 10) || 0;
  const lastIndex = parseInt(imagelastindex, 10) || 150;
  const BATCH_SIZE = 10; // upload this many files per request

  try {
    const dbxToken = await getDropboxAccessToken();

    // ── First request: resolve folder name and total attachment list ─────────
    let folderName = dropboxFolder || null;
    let existingDownloadLink = download_link || null;

    const attachments = await getSM8Attachments(jobid, token);

    // Filter to actual file attachments (skip notes/text entries)
    const fileAttachments = attachments.filter(
      (a) => a.active !== 0 && a.uri && a.uri.startsWith("http")
    );

    if (fileAttachments.length === 0) {
      return res.json({ download_link: false, diagnostics: { reason: "No file attachments found" } });
    }

    // Resolve folder name on first call
    if (!folderName) {
      const job = await getSM8Job(jobid, token);
      folderName = buildFolderName(job);
    }

    // Determine the slice to process this batch
    const batchEnd = Math.min(currentIndex + BATCH_SIZE, fileAttachments.length);
    const batch = fileAttachments.slice(currentIndex, batchEnd);

    // Upload this batch
    for (const attachment of batch) {
      try {
        const fileData = await downloadSM8File(attachment.uri, token);
        const fileName =
          attachment.filename ||
          attachment.uri.split("/").pop() ||
          `attachment_${attachment.uuid}`;
        await uploadToDropbox(dbxToken, folderName, fileName, fileData);
      } catch (uploadErr) {
        console.error(`Failed to upload ${attachment.uuid}:`, uploadErr.message);
        // Continue with next file rather than failing the whole batch
      }
    }

    const newIndex = batchEnd;

    // If there are more files to process, return pending
    if (newIndex < fileAttachments.length) {
      return res.json({
        download_link: "pending",
        dropboxFolder: folderName,
        currentIndex: newIndex,
        lastIndex: fileAttachments.length,
      });
    }

    // All done — get the shared folder link
    const shareLink = await getDropboxFolderLink(dbxToken, folderName);

    return res.json({
      download_link: shareLink || false,
      dropboxFolder: folderName,
      currentIndex: newIndex,
      lastIndex: fileAttachments.length,
    });
  } catch (err) {
    console.error("Server error:", err.response?.data || err.message);
    return res.status(500).json({
      download_link: false,
      diagnostics: {
        error: err.message,
        detail: err.response?.data || null,
      },
    });
  }
});

app.listen(PORT, () => console.log(`SM8 Dropbox server running on port ${PORT}`));
