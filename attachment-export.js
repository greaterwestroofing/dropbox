// attachment-export.js
// ServiceM8 Simple Function (NodeJS) — paste this into "Edit function" in your SM8 addon

exports.handler = (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const jobId = event.eventArgs.jobUUID;
    const token = event.auth.accessToken;

    // ── Your Railway backend URL ──────────────────────────────────────────────
    const BACKEND = "https://sm8-dropbox-addon-production.up.railway.app";
    // ─────────────────────────────────────────────────────────────────────────

    const strHTMLResponse = `
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Download Attachments</title>
        <link rel="stylesheet" href="https://platform.servicem8.com/sdk/1.0/sdk.css">
        <script src="https://platform.servicem8.com/sdk/1.0/sdk.js"></script>
        <style>
            * { box-sizing: border-box; }

            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                margin: 0;
                padding: 1.25rem;
                background: #f7f8fa;
                color: #1a1a2e;
            }

            .card {
                background: #fff;
                border-radius: 8px;
                padding: 1.5rem;
                box-shadow: 0 1px 4px rgba(0,0,0,0.08);
            }

            h2 {
                margin: 0 0 1rem;
                font-size: 18px;
                font-weight: 600;
                color: #1a1a2e;
            }

            .overlay {
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background: rgba(0,0,0,0.45);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .spinner-box {
                background: #fff;
                padding: 1.5rem 2rem;
                border-radius: 8px;
                text-align: center;
                font-size: 15px;
                color: #444;
            }

            .spinner {
                width: 32px; height: 32px;
                border: 3px solid #e0e0e0;
                border-top-color: #7dc836;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin: 0 auto 0.75rem;
            }

            @keyframes spin { to { transform: rotate(360deg); } }

            #progressText {
                font-size: 13px;
                color: #888;
                margin-top: 0.35rem;
            }

            .btn {
                display: inline-block;
                padding: 0.65rem 1.4rem;
                background: #7dc836;
                color: #fff;
                border: none;
                border-radius: 6px;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                text-decoration: none;
                margin-top: 0.75rem;
            }

            .btn:hover { background: #6bb52e; }

            .btn-outline {
                background: transparent;
                border: 1.5px solid #7dc836;
                color: #7dc836;
            }

            .btn-outline:hover { background: #f0faec; }

            #downloadContainer { display: none; }
            #noDownloadContainer { display: none; }
            #retryContainer { display: none; margin-top: 1rem; }

            .download-url {
                word-break: break-all;
                font-size: 13px;
                color: #555;
                background: #f4f4f4;
                padding: 0.5rem 0.75rem;
                border-radius: 5px;
                margin-top: 0.5rem;
            }

            .error-msg {
                color: #c0392b;
                font-size: 14px;
            }

            #diagnosticInfo {
                background: #fff3cd;
                border: 1px solid #ffc107;
                border-radius: 5px;
                padding: 0.75rem 1rem;
                margin-top: 1rem;
                font-family: monospace;
                font-size: 11px;
                max-height: 300px;
                overflow-y: auto;
                display: none;
            }
        </style>
    </head>
    <body>
        <div id="overlay" class="overlay">
            <div class="spinner-box">
                <div class="spinner"></div>
                <div>Uploading to Dropbox…</div>
                <div id="progressText"></div>
            </div>
        </div>

        <div class="card">
            <h2>Job Attachments</h2>

            <div id="downloadContainer">
                <p style="margin:0 0 0.4rem; font-size:14px; color:#555;">
                    All files have been uploaded to Dropbox.
                </p>
                <div class="download-url" id="downloadUrl"></div>
                <a id="downloadLink" class="btn" href="#" target="_blank">Open in Dropbox</a>
            </div>

            <div id="retryContainer">
                <p style="margin:0 0 0.75rem; font-size:14px; color:#555;">
                    Some files are still uploading. Click Continue to finish.
                </p>
                <button class="btn btn-outline" id="continueBtn">Continue uploading</button>
            </div>

            <div id="noDownloadContainer">
                <p class="error-msg">No attachments found for this job.</p>
            </div>

            <div id="diagnosticInfo"></div>
        </div>

        <script>
            // State
            let state = {
                jobId: "${jobId}",
                token: "${token}",
                backend: "${BACKEND}",
                currentIndex: 0,
                lastIndex: 150,
                dropboxFolder: "",
                downloadLink: ""
            };

            document.addEventListener("DOMContentLoaded", function () {
                fetchBatch(true);
            });

            document.getElementById("continueBtn").addEventListener("click", function () {
                document.getElementById("retryContainer").style.display = "none";
                fetchBatch(false);
            });

            function fetchBatch(isFirst) {
                const overlay = document.getElementById("overlay");
                const progressText = document.getElementById("progressText");
                overlay.style.display = "flex";

                if (state.lastIndex > 0 && !isFirst) {
                    progressText.textContent =
                        "Files " + state.currentIndex + " of " + state.lastIndex;
                } else {
                    progressText.textContent = "";
                }

                let url = state.backend + "/attachment"
                    + "?jobid=" + encodeURIComponent(state.jobId)
                    + "&token=" + encodeURIComponent(state.token)
                    + "&imagecurrentindex=" + state.currentIndex
                    + "&imagelastindex=" + state.lastIndex;

                if (!isFirst) {
                    url += "&dropboxFolder=" + encodeURIComponent(state.dropboxFolder);
                    if (state.downloadLink) {
                        url += "&download_link=" + encodeURIComponent(state.downloadLink);
                    }
                }

                fetch(url)
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        overlay.style.display = "none";
                        handleResponse(data);
                    })
                    .catch(function(err) {
                        overlay.style.display = "none";
                        showError("Network error: " + err.message);
                    });
            }

            function handleResponse(data) {
                if (data.download_link === "pending") {
                    state.dropboxFolder = data.dropboxFolder || state.dropboxFolder;
                    state.currentIndex = data.currentIndex || state.currentIndex;
                    state.lastIndex = data.lastIndex || state.lastIndex;
                    document.getElementById("retryContainer").style.display = "block";
                    return;
                }

                if (data.download_link && data.download_link !== false) {
                    const url = extractUrl(data.download_link);
                    document.getElementById("downloadUrl").textContent = url;
                    document.getElementById("downloadLink").href = url;
                    document.getElementById("downloadContainer").style.display = "block";
                    return;
                }

                // False / error
                document.getElementById("noDownloadContainer").style.display = "block";
                if (data.diagnostics) {
                    const diag = document.getElementById("diagnosticInfo");
                    diag.style.display = "block";
                    diag.innerHTML = "<strong>Diagnostics</strong><pre>"
                        + JSON.stringify(data.diagnostics, null, 2) + "</pre>";
                }
            }

            function showError(msg) {
                document.getElementById("noDownloadContainer").style.display = "block";
                document.getElementById("noDownloadContainer").querySelector(".error-msg")
                    .textContent = msg;
            }

            function extractUrl(text) {
                if (!text) return "";
                const i = text.indexOf("https");
                if (i === -1) return text;
                const rest = text.substring(i);
                const end = rest.indexOf(" ");
                return end === -1 ? rest : rest.substring(0, end);
            }
        </script>
    </body>
    </html>`;

    callback(null, { eventResponse: strHTMLResponse });
};
