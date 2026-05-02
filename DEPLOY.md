# Deployment Guide

Going from local dev to a live PWA installed on tech phones. Should take under an hour total.

## What's already done

The PWA scaffolding ships in this repo and does not need to be re-built:

- `public/manifest.json` — name, theme color, icons
- `public/sw.js` — service worker, app-shell caching, offline fallback to `/login`
- Service worker registration in `components/Providers.tsx`
- Apple Web App + viewport meta in `app/layout.tsx`
- Icon set: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.png`
- IndexedDB photo upload queue (`lib/upload-queue.ts`) — already offline-tolerant

Service workers require HTTPS, so the unlock for PWA behavior is simply deploying behind a real domain. Vercel provides this automatically.

---

## Step 1 — Push to GitHub

Verify no secrets are about to be committed:

```powershell
cd "c:\Users\kevin\OneDrive\Desktop\ClaudeCode\MSE Tech App\mse-field"
git ls-files | Select-String env
```

Expected output: `.env.example`, `lib/env.ts`, `scripts/build-env.mjs`. If `.env.local` shows up, **stop** — add it to `.gitignore` first.

Commit and push:

```powershell
git add -A
git commit -m "Pre-deploy state"
gh repo create mse-field --private --source=. --remote=origin --push
```

If `gh` (GitHub CLI) isn't installed: create the repo manually at github.com/new (private), then:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/mse-field.git
git push -u origin main
```

---

## Step 2 — Vercel project

1. Go to [vercel.com/new](https://vercel.com/new) and import the repo
2. Framework preset: Next.js (auto-detected)
3. Root directory: leave as `./`
4. **Before clicking Deploy**, expand "Environment Variables" and add the values below

### Environment variables

Copy these from your local `.env.local`:

| Variable | Notes |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Plain string, e.g. `mse-field@project-id.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Paste the entire `-----BEGIN PRIVATE KEY-----...END PRIVATE KEY-----` block. Vercel preserves newlines. |
| `GOOGLE_SHEET_ID` | The Google Sheet ID from its URL |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | The Drive folder ID where job photos live |
| `IRON_SESSION_PASSWORD` | 32+ chars. Generate fresh — do not reuse local. See command below. |
| `APP_URL` | Set after first deploy, e.g. `https://mse-field.vercel.app` |

Generate a fresh session password (run locally):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Click **Deploy**. First build takes about 90 seconds.

---

## Step 3 — Smoke test on production

Open the deployment URL on your phone. Run through this checklist:

- [ ] Login with PIN succeeds
- [ ] Create a new job
- [ ] Add a unit, capture all required photos, save
- [ ] Verify the row appears in the Google Sheet
- [ ] Verify the photos appear in the Drive folder
- [ ] Submit the job, verify pay attribution rows write
- [ ] Reload the page, verify it loads instantly (service worker caching)

If photo upload fails, the service account does not have access. Verify:

- The Google Sheet is shared with the service account email (Editor)
- The Drive root folder is shared with the service account email (Editor)

---

## Step 4 — Install on phone

This is the moment.

**iPhone (Safari):** Open the production URL → Share button → Add to Home Screen → Add. The app opens fullscreen with no Safari chrome and shows the MSE icon on the home screen.

**Android (Chrome):** Open the production URL → three-dot menu → Install app (or "Add to Home Screen"). Same fullscreen experience.

After install, the service worker pre-caches the shell pages. If a tech loses cell signal in a basement, the app still loads, the IndexedDB queue keeps photos waiting, and uploads resume when signal returns.

---

## Step 5 — Custom domain (optional)

If you want `field.mdsmartenergy.com` instead of `*.vercel.app`:

1. Vercel project → Settings → Domains → Add
2. Enter the domain, copy the DNS records Vercel shows
3. Add the records in your DNS host (Cloudflare, GoDaddy, etc.)
4. Wait 1–10 min for DNS propagation
5. Update `APP_URL` env var to the new domain
6. Redeploy (Vercel → Deployments → ⋯ → Redeploy)

---

## Step 6 — Production hygiene

Small things, do once.

### Block search indexing

This is an internal tool. Create `app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
```

### Vercel Analytics

Free, one-line install, gives per-page load times.

```powershell
npm install @vercel/analytics
```

In `app/layout.tsx`, add inside `<body>`:

```tsx
import { Analytics } from "@vercel/analytics/next";
// ...
<Analytics />
```

### Bump SW cache version on each deploy

In `public/sw.js`, the cache key is `mse-field-v1`. When you ship a substantive change to the shell (login page, jobs page, layout), bump it: `v1` → `v2`. Otherwise installed PWAs can serve stale UI for hours.

You can automate this later with the build commit SHA.

---

## Operational caveats worth knowing

### Sheet quota in serverless

`lib/google/sheets.ts` has a 30-second in-memory read cache. On Vercel's serverless functions, each invocation is its own process, so the cache mostly doesn't dedupe across requests. Quota usage will be higher in production than in local dev.

Google enforces 60 reads/min/user. Watch for it the first week. If you hit it, the next iteration is moving the cache to Vercel KV or Upstash Redis (about a half-day of work).

### IndexedDB queue is per-device

If a tech logs in on a borrowed phone, captures photos offline, and never reconnects on that device, those photos are stuck on that phone. Tell techs not to swap devices mid-job.

### PIN auth has no rate limiting

Anyone with the URL can brute-force 10,000 four-digit PINs. For a small-team internal app this is acceptable, but worth knowing. To add rate limiting later: track `failed_attempts` in iron-session, lock the IP for 60s after 5 failures.

### "Install" prompt fires once

If a tech dismisses the browser's install prompt, Chrome remembers and won't re-offer for ~90 days. They can still install manually via the menu, but coach the team to accept on first run.

---

## Going forward — push-to-deploy workflow

After initial setup, deployments are automatic:

```powershell
git add -A
git commit -m "Description of change"
git push
```

Vercel rebuilds and ships in ~90 seconds. Watch the deployment at vercel.com/your-project. If it fails, the build log shows why.

To roll back: Vercel Deployments page → click any prior deployment → "Promote to Production."

---

## When something breaks

| Symptom | Likely cause |
|---|---|
| 500 on every page | Missing env var. Check Vercel Logs → Runtime Logs. |
| Photos upload but Sheet row never updates | Service account not shared on Sheet, or quota hit. Check Vercel logs for 403/429. |
| PIN login always fails | `IRON_SESSION_PASSWORD` mismatch between deployments invalidated all sessions. Have techs log in again. |
| "Add to Home Screen" doesn't show on Android | Open Chrome DevTools (remote debug) → Application → Manifest. Check for warnings. Usually a missing icon. |
| App loads but photos don't show in Edit screen | The `/api/photo` proxy needs `requireSession()` to pass — make sure the tech is logged in on that device. |
| Service worker serving stale UI | Bump cache version in `public/sw.js`. Force-refresh on the device (uninstall + reinstall PWA). |

---

## End-to-end test from a clean state

To verify the full system after deploy:

```powershell
# Locally, against production
$env:BASE_URL = "https://your-vercel-url.vercel.app"
npm run e2e -- $env:BASE_URL 1234
```

Replace `1234` with a real tech PIN. Test will hit production, create a real job, real units, real photos. Clean up the test data from the Sheet afterward.
