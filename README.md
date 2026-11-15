# ShortCut Marketing

Create and run video ads on **Meta (Facebook + Instagram)**, with **Google Ads / YouTube** next — from one place.
Built to plug into [ShortcutVid](https://shortcutvid.in): make a video, then click **Boost** to turn it into an ad.

## What works today (v0.1)

- **Connect Meta** with Facebook login (OAuth). Tokens are swapped for long‑lived ones and stored AES‑256‑GCM encrypted.
- **Pick the ad account and Facebook Page** to advertise from.
- **Boost a video** with one form: goal, daily budget, days, countries, age, gender, video, text, link and button.
  - Creates video → campaign → ad set → creative → ad through the Marketing API.
  - Always created **paused** unless you tick "Start right away"; the campaign is only switched on after every piece exists.
  - If any step fails, the half-built campaign is deleted automatically.
- **Dashboard** with spend, impressions, clicks, CTR and video views, plus pause/start.
- **Server-to-server API** so ShortcutVid can boost videos directly.
- Google Ads connector is scaffolded (login URL ready); launching switches on once the developer token is approved.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

No database setup is needed in development — an embedded Postgres (PGlite) is stored in `./.data`.
In production set `DATABASE_URL` to a Postgres database; migrations in `./drizzle` run automatically.

| Variable | What it is |
|---|---|
| `APP_URL` | Public URL of this app (used for the OAuth redirect) |
| `META_APP_ID`, `META_APP_SECRET` | From your app at developers.facebook.com |
| `META_API_VERSION` | Graph API version, default `v25.0` |
| `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DATABASE_URL` | Postgres URL (production only) |
| `SCM_API_KEY` | Shared secret for ShortcutVid → `/api/v1/*` calls |

## Setting up the Meta app

1. developers.facebook.com → **My Apps → Create App** → type **Business**.
2. Add the **Marketing API** and **Facebook Login for Business** products.
3. Add the redirect URI: `{APP_URL}/api/connect/meta/callback`.
4. Start **Business Verification** for your company.
5. While you build: your own (developer) accounts work immediately — use Meta's **sandbox ad account** to test without spending.
6. Before customers can connect, submit **App Review** for `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`.
   Record a screen video of: Connect Meta → pick account/page → Boost a video → Dashboard. Describe it as *"ShortcutVid lets customers turn their videos into Facebook/Instagram ads and track results."*

## Connecting ShortCut Marketing to ShortcutVid

**Option 1 — link (no code):** add a "Boost" button on each video in ShortcutVid that opens

```
https://<this-app>/boost?videoUrl=<public mp4 url>&thumbnailUrl=<jpg>&title=<video title>&link=<landing page>
```

**Option 2 — API (server-to-server):**

```bash
# List a user's connected ad accounts
curl -H "x-api-key: $SCM_API_KEY" "https://<this-app>/api/v1/connections?userId=USER_ID"

# Launch an ad
curl -X POST https://<this-app>/api/v1/boost \
  -H "x-api-key: $SCM_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID",
    "connectionId": "CONNECTION_ID",
    "spec": {
      "name": "Diwali sale video",
      "objective": "traffic",
      "dailyBudget": 500,
      "audience": { "countries": ["IN"], "ageMin": 21, "ageMax": 45, "gender": "all" },
      "creative": {
        "videoUrl": "https://cdn.shortcutvid.in/v/abc.mp4",
        "primaryText": "Diwali offers are live!",
        "headline": "Up to 50% off",
        "linkUrl": "https://yourshop.in",
        "callToAction": "SHOP_NOW"
      },
      "launchActive": false
    }
  }'
```

Objectives: `traffic` (website visits), `video_views`, `awareness` (reach). `dailyBudget` is in the ad account's currency (500 = ₹500).

**User identity:** for now each browser gets an anonymous ID cookie (`src/middleware.ts`, `src/lib/user.ts`).
When merging into ShortcutVid, make `getUserId()` return ShortcutVid's logged-in user ID — nothing else changes.

## How it's built

```
src/lib/connectors/types.ts   One campaign format (CampaignSpec) + the AdConnector interface
src/lib/connectors/meta.ts    Meta Marketing API implementation
src/lib/connectors/google.ts  Google Ads (phase 2)
src/lib/service.ts            Connections, launching, stats (database + connectors)
src/app/api/...               HTTP routes (OAuth, campaigns, ShortcutVid API)
src/app/{page,boost,connections}  UI
```

Adding a platform = one new file implementing `AdConnector` + registering it in `connectors/index.ts`.

Stack: Next.js 15, TypeScript, Drizzle ORM (Postgres / PGlite), Zod.

## Deploying (CI/CD)

`.github/workflows/ci-cd.yml` runs on every push and pull request:

1. **CI** — install, type-check, tests, production build.
2. **CD** — only when CI passes on `main`: GitHub connects to the server over SSH and runs `scripts/deploy.sh <commit>`.

`deploy.sh` builds each commit in its own folder (`/var/www/scm/releases/<sha>`) while the old version keeps serving,
then switches over and reloads pm2. If the build fails, the live site is untouched; if the new version fails its
health check, it rolls back to the last good release automatically. The last 5 releases are kept.

### One-time server setup (Ubuntu VPS)

1. Point your domain (e.g. `ads.shortcutvid.in`) to the server's IP.
2. On the server:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/premprakaash/ShortCutMarketing/main/scripts/server-setup.sh -o setup.sh
   bash setup.sh ads.shortcutvid.in
   ```
   This installs Node, Postgres, Nginx, HTTPS and pm2, creates the database, and writes
   `/var/www/scm/shared/.env.local` with generated secrets.
3. Add `META_APP_ID` and `META_APP_SECRET` to `/var/www/scm/shared/.env.local`.
4. First deploy by hand: `bash /var/www/scm/repo/scripts/deploy.sh`

### Connect GitHub to the server

1. Create a deploy key on your computer: `ssh-keygen -t ed25519 -f scm_deploy -N ""`
2. On the server, add `scm_deploy.pub` to `~/.ssh/authorized_keys` of the user that ran setup.
3. GitHub repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Value |
|---|---|
| `SSH_HOST` | Server IP or hostname |
| `SSH_USER` | The Linux user that ran setup |
| `SSH_KEY` | Contents of the private key `scm_deploy` |
| `SSH_PORT` | Optional, default `22` |
| `APP_DIR` | Optional, default `/var/www/scm` |

4. (Optional) **Settings → Environments → production** → add yourself as a required reviewer to approve each deploy.

After that: merge or push to `main` → tests run → the server updates itself. Watch progress in the **Actions** tab;
on the server, `pm2 logs scm` shows app logs.

## Tests

```bash
npm test         # connector logic against a fake Graph API, DB service on embedded Postgres, encryption
npm run typecheck
```

## Roadmap

1. ✅ Meta: connect, boost video, dashboard
2. Google Ads: Search + YouTube video campaigns (needs developer token Basic access)
3. One form → launch on Meta **and** Google together
4. TikTok, Microsoft, Pinterest, LinkedIn
5. Lead form ads + WhatsApp follow-up
6. Billing (subscription or % of ad spend)
