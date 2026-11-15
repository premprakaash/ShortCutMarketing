# ShortCut Marketing

**One ad. Every platform.** Generate a video ad with AI, then launch it on Meta, Google/YouTube, TikTok,
LinkedIn, Pinterest and Snapchat — with a budget per platform — and track everything on one dashboard.
Built to plug into [ShortcutVid](https://shortcutvid.in).

## Features

| | |
|---|---|
| **Create campaign wizard** | Describe → Video → Platforms & budget → Audience → Ad copy → Launch. One form launches on every selected platform; each platform succeeds or fails on its own, with clear errors. |
| **AI ad writer** | Claude turns a product description into a video prompt + ad copy sized for every platform (headlines, descriptions, keywords, CTA). |
| **AI video studio** | Pick a video model (Google Veo 3.1, Kling 3.0/2.6, Seedance 2.0 via fal.ai), format (9:16 / 16:9 / 1:1) and length. AI can write the prompt. Videos are saved to your library. |
| **Unified dashboard** | Spend, impressions, clicks, CTR and video views across all platforms, a by-platform breakdown, filters, pause/start. |
| **Ad accounts** | Connect each platform with its own login; tokens are encrypted (AES-256-GCM) and refreshed automatically. |
| **Safe by default** | Ads are created **paused** unless you tick "Start right away". If a step fails mid-way, the half-built campaign is removed. |
| **ShortcutVid API** | Server-to-server endpoints to launch ads for your users (see below). |

### Platform support

| Platform | What gets created | "Page" it needs |
|---|---|---|
| Meta | Campaign → ad set → video creative → ad (Facebook, Instagram, Reels) | Facebook Page |
| Google Ads | **Search** campaign (keywords + responsive search ad), or **YouTube Demand Gen** video campaign when you give a YouTube video ID + logo. Created atomically in one request. | — |
| TikTok | Video upload by URL → campaign → ad group → ad | TikTok identity |
| LinkedIn | Video upload → campaign group → video campaign → sponsored (dark) post creative | Company page linked to the ad account |
| Pinterest | Video upload → video Pin → campaign → ad group → ad | Board (+ cover image) |
| Snapchat | Video upload → creative → campaign → ad squad → ad | Public profile |
| Microsoft, Reddit, X, Amazon | Shown as *coming soon* | |

> **Before going live on a platform**, create one paused test campaign with a real account and check it in that
> platform's own ads manager. The connectors follow each platform's current API docs and are covered by tests against
> simulated APIs, but ad APIs change often and some fields (targeting, objectives) differ by country and account type.
> Google needs videos hosted on YouTube; Snapchat videos must be under 32 MB at 1080×1920.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have — every platform is optional
npm run dev                  # http://localhost:3000
```

No database setup is needed in development — an embedded Postgres (PGlite) is stored in `./.data`.
In production set `DATABASE_URL`; migrations in `./drizzle` run automatically.

All settings are documented in [`.env.example`](.env.example). A platform shows **Connect** on the Ad accounts page as soon
as its keys are set; otherwise it shows which keys are missing.

## Getting the keys

Register this redirect URL on every platform: **`{APP_URL}/api/connect/<platform>/callback`**
(e.g. `https://ads.shortcutvid.in/api/connect/tiktok/callback`).

| Platform | Where | Permissions / scopes to request |
|---|---|---|
| **Meta** | developers.facebook.com → Create App (Business) → add Marketing API + Facebook Login for Business. Complete Business Verification, then App Review. | `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement` |
| **Google** | Google Cloud Console → OAuth client (Web). Google Ads → Tools → API Center → developer token (needs Basic access for real accounts). | `https://www.googleapis.com/auth/adwords` |
| **TikTok** | business-api.tiktok.com → My Apps → create a Marketing API app; set the advertiser redirect URL. | Ad account management, Ads management, Reporting, Creative management |
| **LinkedIn** | linkedin.com/developers → create app → request the **Advertising API** product. | `r_ads`, `rw_ads`, `r_ads_reporting`, `r_basicprofile` |
| **Pinterest** | developers.pinterest.com → create app → request **Standard** access (Trial can't create ads). | `ads:read/write`, `boards:read/write`, `pins:read/write`, `user_accounts:read` |
| **Snapchat** | business.snapchat.com → Business Details → OAuth App. | `snapchat-marketing-api` |
| **Claude (AI copy)** | console.anthropic.com → API keys → `ANTHROPIC_API_KEY` | |
| **fal.ai (AI video)** | fal.ai/dashboard/keys → `FAL_KEY`. Video models are billed per second by fal. Model IDs live in `src/lib/ai/video.ts`. | |

## Branding

The logo is `public/logo.svg` (also `src/app/icon.svg` for the browser tab). Replace both files with your own logo.
Colours are CSS variables at the top of `src/app/globals.css` (`--yellow`, `--bg`, …).

## Connecting to ShortcutVid

**Link (no code):** a "Promote" button on any ShortcutVid video can open

```
https://<this-app>/create?videoUrl=<public mp4>&thumbnailUrl=<jpg>&title=<video title>&link=<landing page>
```

**API (server-to-server)** — send `x-api-key: $SCM_API_KEY`:

| Endpoint | What it does |
|---|---|
| `GET /api/v1/connections?userId=…` | A user's connected ad accounts |
| `POST /api/v1/launch` | `{ userId, launch: { name, objective, audience, creative, targets: [{ connectionId, dailyBudget }] } }` — launch on several platforms; returns per-platform results |
| `POST /api/v1/boost` | `{ userId, connectionId, spec }` — launch on one platform |

```bash
curl -X POST https://<this-app>/api/v1/launch -H "x-api-key: $SCM_API_KEY" -H "Content-Type: application/json" -d '{
  "userId": "USER_ID",
  "launch": {
    "name": "Diwali sale video", "objective": "traffic",
    "audience": { "countries": ["IN"], "ageMin": 21, "ageMax": 45, "gender": "all" },
    "creative": {
      "videoUrl": "https://cdn.shortcutvid.in/v/abc.mp4",
      "primaryText": "Diwali offers are live!", "headline": "Up to 50% off",
      "headlines": ["Diwali sale is live", "Handmade sweets", "Order today"],
      "descriptions": ["Fresh sweets delivered", "Gift boxes for family"],
      "keywords": ["diwali sweets online"], "businessName": "Sweet Co",
      "linkUrl": "https://yourshop.in", "callToAction": "SHOP_NOW"
    },
    "targets": [ { "connectionId": "META_CONN_ID", "dailyBudget": 500 }, { "connectionId": "GOOGLE_CONN_ID", "dailyBudget": 300 } ],
    "launchActive": false
  }
}'
```

**User identity:** each browser currently gets an anonymous ID cookie (`src/middleware.ts`, `src/lib/user.ts`).
When merging into ShortcutVid, make `getUserId()` return ShortcutVid's logged-in user ID — nothing else changes.

## How it's built

```
src/lib/connectors/types.ts     One campaign format (CampaignSpec / MultiLaunch) + AdConnector interface
src/lib/connectors/*.ts         meta, google, tiktok, linkedin, pinterest, snapchat
src/lib/platforms.ts            Display info for every platform (incl. coming-soon)
src/lib/service.ts              Connections, token refresh, multi-platform launch, stats
src/lib/ai/claude.ts            AI ad kit + prompt writer (Claude, forced tool use)
src/lib/ai/video*.ts            fal.ai video models, async jobs, library
src/app/                        Dashboard, Create wizard, AI Studio, Ad accounts, API routes
```

Adding a platform = one file implementing `AdConnector` + an entry in `platforms.ts` and `connectors/index.ts`.

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
3. Add your AI and ad-platform keys to `/var/www/scm/shared/.env.local` (see "Getting the keys").
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
npm test           # every connector against simulated APIs, AI clients, DB service, encryption
npm run typecheck
```

## Roadmap

1. ✅ Meta, Google (Search + YouTube), TikTok, LinkedIn, Pinterest, Snapchat
2. ✅ AI copy + AI video generation, multi-platform launch, unified dashboard
3. Microsoft Advertising, Reddit, X, Amazon
4. Daily charts and date ranges on the dashboard
5. Upload your own video files (storage) and auto-upload to YouTube for Google video ads
6. Lead-form ads + WhatsApp follow-up
7. Billing (subscription or % of ad spend)
