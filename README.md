# WhatsApp Outreach Dashboard (Google Sheets edition)

Open the site, sign in, pick a connected Google Sheet, tap **Message on WhatsApp**.
WhatsApp opens with your message ready, and the Sheet is updated at once with the status and time.
Follow-ups and replies are logged the same way. No more uploading a file each time.

## What gets written to your Sheet
The app adds these columns to the right of your data (only if they are missing):
`WA Status`, `First Sent`, `Follow-up 1 Sent`, `Follow-up 2 Sent`, `Replied`, `Outcome`, `Referral Code`, `Notes`.
Keep your headers in **row 1**, and don't rename these eight columns.

## One-time setup (about 20 minutes)

### 1. Google service account (lets the app edit your Sheet)
1. Go to console.cloud.google.com and create a project.
2. APIs & Services > Library > enable **Google Sheets API**.
3. APIs & Services > Credentials > Create credentials > **Service account**. Finish the steps.
4. Open the service account > Keys > Add key > **JSON**. A file downloads.
5. From that file you need two values: `client_email` and `private_key`.

### 2. Put your leads in Google Sheets
1. Upload `ca_partner_tracker.xlsx` to Google Drive and open it with Google Sheets (File > Save as Google Sheets).
2. Click **Share** and add the service account's `client_email` as an **Editor**.
3. Copy the sheet ID from the URL: `docs.google.com/spreadsheets/d/<THIS PART>/edit`.

### 3. Deploy on Vercel
1. Put this folder in a GitHub repo and import it in Vercel (Framework: Other). No build command needed.
2. In Project > Settings > Environment Variables add:

| Name | Value |
|---|---|
| `APP_PASSWORD` | the password you will type to sign in |
| `SESSION_SECRET` | any long random text (40+ characters) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` |
| `GOOGLE_PRIVATE_KEY` | the `private_key`, pasted exactly as in the JSON (with the `\n` marks) |
| `SHEET_IDS` | `sheetId1\|CA partners,sheetId2\|Business leads` (label after the pipe is optional) |

3. Redeploy. Open the site, sign in, and your connected sheets appear in the dropdown.

To connect another sheet later: share it with the service account, add its ID to `SHEET_IDS`, redeploy.

## Try it on your computer first (no Google needed)
```
npm install
npm run dev
```
Open http://localhost:3000. Password: `demo`. This uses sample data kept in memory.

## Good to know
- **Safety check:** before writing, the app confirms the row still has the same phone number, so a re-sorted sheet can't log against the wrong person.
- **Pace:** the app warns when you pass 40 messages in a day. You always tap Send yourself.
- **Templates, your name and the partner offer line** are saved in your browser. The data and statuses live in the Sheet.
- **Referral codes:** choosing the outcome "Partner joined" gives the lead a code (e.g. CA014). Log each referred project in the `Referrals` tab.
- **Vercel plan:** Vercel's free Hobby plan is for non-commercial use, so for business use check Vercel's current terms.
