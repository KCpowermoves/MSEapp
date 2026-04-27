# MSE Field

Internal field-ops PWA for Maryland Smart Energy 1099 service technicians. Lets techs capture the required photo packages per unit, log job + unit details in the field, and trigger payment by completing the photos. The admin side is a single Google Sheet — no separate admin UI.

- **Users:** Techs (Jalen, Dante, Jamal, future hires) on phones in the field. Admins (Kevin, Crystal, Errol) live in the Sheet.
- **Photos:** Stored in a single shared Google Drive folder, organized by job → unit → photo type, with hyperlinks back to each job in the Sheet.
- **Pay:** Calculated via Sheet formulas in the `Pay Calc` tab. Errol can audit any number against `Pay Attribution`.

## One-time setup (Kevin does this once)

You'll need ~30 minutes the first time. Have a Google account ready that owns the company Sheet/Drive (probably `service@mdsmartenergy.com`).

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/projectcreate and create a project named `MSE Field`.
2. With that project selected, enable two APIs:
   - https://console.cloud.google.com/apis/library/sheets.googleapis.com → click **Enable**
   - https://console.cloud.google.com/apis/library/drive.googleapis.com → click **Enable**

### 2. Create a service account

1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts (make sure the `MSE Field` project is selected).
2. **Create Service Account** → name it `mse-field-app`. No roles needed. Click Done.
3. Click into the new service account → **Keys** tab → **Add Key → Create new key → JSON**. A `.json` file downloads. Open it — you'll need two values from inside:
   - `client_email` (looks like `mse-field-app@mse-field.iam.gserviceaccount.com`)
   - `private_key` (a long block starting with `-----BEGIN PRIVATE KEY-----`)

### 3. Create the Google Sheet

1. Go to https://sheets.google.com and create a new blank spreadsheet.
2. Rename it: **MSE Field Operations**
3. Click **Share** → paste in the service account email from step 2 → give it **Editor** access → uncheck "notify people" → Send.
4. From the URL, copy the Sheet ID. The URL looks like:
   `https://docs.google.com/spreadsheets/d/`**`1aBcDeF...xyz`**`/edit` — the bold part is the Sheet ID.

### 4. Create the Drive root folder

1. Go to https://drive.google.com and create a new folder named **MSE Field Photos**.
2. Right-click → **Share** → paste the service account email → give it **Editor** access → Send.
3. Open the folder. From the URL, copy the folder ID:
   `https://drive.google.com/drive/folders/`**`1aBcDeF...xyz`** — the bold part is the folder ID.

### 5. Configure local env

In this repo:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in all five values:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=mse-field-app@mse-field.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1aBcDeF...xyz
GOOGLE_DRIVE_ROOT_FOLDER_ID=1aBcDeF...xyz
IRON_SESSION_PASSWORD=<run: openssl rand -base64 32>
```

For `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: copy the `private_key` value from the JSON file as-is. Keep the `\n` sequences — the app un-escapes them at runtime. Wrap the whole thing in double quotes.

For `IRON_SESSION_PASSWORD`: run `openssl rand -base64 32` in a terminal and paste the output. This signs the auth cookie. Treat it like a secret.

### 6. Install + initialize

```bash
npm install
npm run test:google     # smoke test — should print Sheet metadata + folder name
npm run seed            # creates all tabs, headers, formulas
npm run test:google     # re-run — should now show Techs tab
```

If the first `test:google` fails with a permissions error, double-check that you shared both the Sheet and the Drive folder with the service account email.

### 7. Add your techs

```bash
npm run add-tech -- --name "Jalen Smith" --pin 1234 --phone "+12025551234"
npm run add-tech -- --name "Dante Brown" --pin 5678
npm run add-tech -- --name "Jamal Carter" --pin 9012
```

PIN is hashed with bcrypt before being written. Re-run with the same `--name` to rotate a tech's PIN.

### 8. Run the app

```bash
npm run dev
```

Open http://localhost:3000, log in with one of the PINs you just set.

## Deploying to Vercel

```bash
vercel link
vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL production
vercel env add GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY production
vercel env add GOOGLE_SHEET_ID production
vercel env add GOOGLE_DRIVE_ROOT_FOLDER_ID production
vercel env add IRON_SESSION_PASSWORD production
vercel env add APP_URL production    # https://your-deploy.vercel.app
vercel deploy --prod
```

The private key needs the `\n` escape sequences preserved when entering through the Vercel CLI. Easiest: paste the raw multi-line key, the CLI handles escaping.

## How techs use it

1. Open the deploy URL on their phone.
2. Add to home screen (PWA install banner appears automatically).
3. Enter their 4-digit PIN. Session lasts 30 days.
4. Pick the active job from the dropdown, or create a new one.
5. Set today's crew (who's on site).
6. For each unit: pick the type, capture 5 photos (Pre, Post, Clean, Nameplate, Filter), save.
7. For thermostats / endo cubes: tap "+ Add Service".
8. End of day: tap "Submit Dispatch", set crew split + driver, hit Submit.

If they have no signal: photos queue locally and auto-upload when signal comes back. The "X pending" badge shows queue depth.

## Sheet tab reference

- **Techs** — login records + PIN hashes
- **Jobs** — every job site, with hyperlink to the Drive folder
- **Dispatches** — one row per crew-day on a job, with crew split + driver + photos-complete
- **Units Serviced** — one row per HVAC unit, with all five photo URLs
- **Additional Services** — thermostats, endo cubes, standalone trips
- **Pay Rates** — hard-coded reference table for the formulas
- **Pay Attribution** *(hidden)* — audit trail rows; formulas in Pay Calc sum these
- **Pay Calc** — pay-period totals per tech. Set the date range in row 1.

## Common operations

- **Add a new tech:** `npm run add-tech -- --name "..." --pin XXXX`
- **Rotate a tech's PIN:** same command — it overwrites by name.
- **Deactivate a tech:** open the Techs tab, set their `Active` cell to `FALSE`. They won't be able to log in, and they won't appear in crew/seller pickers.
- **Close a job:** open the Jobs tab, set `Status` to `Closed`. It still shows in the dropdown for 7 days after `Last Activity Date`, then drops off.
- **Re-run seed:** safe — creates only missing tabs, won't overwrite existing data.

## Troubleshooting

**"Permission denied" reading the Sheet** — you didn't share the Sheet with the service account email, or you shared with the wrong email. Open the Sheet → Share → check that the service-account email is listed with Editor.

**"File not found" creating a Drive folder** — same problem on the Drive root folder. Right-click the `MSE Field Photos` folder → Share → add the service account.

**"Invalid grant" on auth** — your `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` env var is malformed. Check that:
1. The whole key is wrapped in double quotes.
2. Newlines are encoded as `\n` (literal backslash-n, two characters).
3. The `-----BEGIN` and `-----END` lines are intact.

**Photos showing "X pending" forever** — open the queue inspector (tap the badge). If errors are listed, the most common cause is a re-deploy invalidating the iron-session cookie; logging out and back in fixes it. If photos are stuck without errors, check that the device has working internet and that the service worker is registered (Chrome → DevTools → Application → Service Workers).
