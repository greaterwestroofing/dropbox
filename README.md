# SM8 Dropbox Addon — Your Own Instance

## File Structure

```
sm8-dropbox-addon/
├── server.js                          ← Deploy this to Railway
├── package.json
├── railway.toml
└── servicem8-function/
    └── attachment-export.js           ← Paste this into your SM8 addon "Edit function"
```

---

## Step 1 — Get a Dropbox Refresh Token

You need a **long-lived refresh token** (not a short-lived access token). Do this once:

1. Go to https://www.dropbox.com/developers/apps and open your app
2. Under **OAuth 2**, set **Access token expiration** to `No expiration` — OR follow the steps below to get an offline refresh token:

```bash
# In your browser, visit:
https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&token_access_type=offline

# Approve it, copy the code, then run:
curl https://api.dropbox.com/oauth2/token \
  -d code=YOUR_CODE \
  -d grant_type=authorization_code \
  -d client_id=YOUR_APP_KEY \
  -d client_secret=YOUR_APP_SECRET
```

Copy the `refresh_token` from the response.

---

## Step 2 — Deploy to Railway

1. Push this repo to GitHub
2. In Railway: **New Project → Deploy from GitHub repo** → select this repo
3. Add these **Environment Variables** in Railway:

| Variable               | Value                        |
|------------------------|------------------------------|
| `DROPBOX_APP_KEY`      | Your Dropbox app key         |
| `DROPBOX_APP_SECRET`   | Your Dropbox app secret      |
| `DROPBOX_REFRESH_TOKEN`| The refresh token from Step 1|

4. Railway will auto-deploy. Your URL will be:
   `https://sm8-dropbox-addon-production.up.railway.app`

5. Test it: visit `https://sm8-dropbox-addon-production.up.railway.app/` — you should see `SM8 Dropbox Addon OK`

---

## Step 3 — Configure the ServiceM8 Addon

1. In ServiceM8 Developer portal, open your addon
2. Click **Edit function**
3. Paste the entire contents of `servicem8-function/attachment-export.js`
4. Click **Save**

The addon will now use your Railway server and your Dropbox account — not anyone else's.

---

## How It Works

1. User opens the addon on a job in ServiceM8
2. The SM8 function renders the UI with the job UUID + access token baked in
3. The UI calls your Railway `/attachment` endpoint
4. Railway fetches attachments from SM8 API, uploads them to Dropbox into a folder named `{JobNumber} - {JobAddress}`
5. If there are many files, it processes in batches of 10 with a "Continue" button between batches
6. Once complete, a shared Dropbox folder link is shown

---

## Dropbox Folder Naming

Folders are created as: `{JobNumber} - {JobAddress or Description}`

Example: `1042 - 14 Smith Street Northcote`
