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
