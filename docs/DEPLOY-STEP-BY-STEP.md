# Deploying HALO 3EL Autotrader · Firebase + Cloudflare, step by step

This is the full walkthrough for putting HALO online with:

| Piece | Service | What it does |
|---|---|---|
| The app and the trading bots | **Firebase App Hosting** (runs on Google Cloud Run) | Runs the Next.js server, all API routes and the always-on bot engine |
| Database | **PostgreSQL** (Neon, Supabase or Google Cloud SQL) | Stores users, licences, payments, trades and settings |
| Your domain, HTTPS, protection | **Cloudflare** | DNS, SSL, caching of static files, firewall in front of the app |
| Keep-alive | **Cloudflare Worker** (cron, every minute) | Pings the app so the bot engine keeps ticking |

> **Why not Firestore?** HALO's database layer (Prisma) is relational: users, licences, payments and trades are linked tables. Prisma does not support Firestore, so the database is PostgreSQL. You still use your **Firebase** project, because Firebase App Hosting runs the app.

> **Why not Cloudflare Pages/Workers for the app itself?** The app needs a full Node.js server: Prisma, e-mail, web push and long-running bot timers. The Cloudflare Workers runtime can't run those. Cloudflare sits **in front of** Firebase instead.

---

## Step 0 · Before you start

You need:

- A **Google account** and a **Firebase project** on the **Blaze (pay-as-you-go)** plan. App Hosting doesn't work on the free plan.
- A **GitHub** account with this repository pushed to it (recommended), or the code on your computer.
- A **Cloudflare** account and a **domain name** (for example `yourdomain.com`).
- **Node.js 20 or newer** on your computer.

Install the two command-line tools once:

```bash
npm install -g firebase-tools
```

```bash
npm install -g wrangler
```

**Commit and push your code first.** A GitHub-connected App Hosting backend deploys what is on the branch, not uncommitted files on your computer.

> **Cost:** `apphosting.yaml` keeps **exactly one instance running all the time** (`minInstances: 1`). That is required for the bot, and it is billed continuously. Check current Cloud Run pricing for 1 vCPU / 1 GiB before you go live.

---

## Step 1 · Create the PostgreSQL database

The easiest option is **Neon** (neon.tech). Supabase works the same way.

1. Sign up at neon.tech and click **New project**. Name it `halo` and pick the region closest to `us-central1` (for example **US East**).
2. Open **Connection details** and copy the connection string. It looks like:
   `postgresql://USER:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/halo?sslmode=require`
3. Keep it private. It goes into a Firebase secret in step 3.

The tables are created automatically during the first build (`prisma db push`). You don't create them by hand.

> Local development keeps using SQLite (`db/custom.db`). The hosted build switches Prisma to PostgreSQL by itself (`scripts/deploy/prisma-provider.mjs`).

---

## Step 2 · Connect the Firebase project

1. In the Firebase console (console.firebase.google.com), create a project (for example `halo-autotrader`) and upgrade it to **Blaze**.
2. On your computer, in the HALO folder, sign in:

```bash
firebase login
```

3. Create `.firebaserc` from the example:

```bash
cp .firebaserc.example .firebaserc
```

4. Open `.firebaserc` and replace `your-firebase-project-id` with your real project ID (shown in Firebase → Project settings).

---

## Step 3 · Create the secrets

Every secret listed in `apphosting.yaml` **must exist, or the build fails.** Each command below asks you to type the value.

### 3a · Generate two random keys

Run this twice and keep both outputs in a password manager:

```bash
openssl rand -hex 32
```

- The first value is your **`HALO_CRON_SECRET`** (shared with the Cloudflare keep-alive worker).
- The second value is your **`HALO_DATA_KEY`**. It encrypts saved broker logins, alert tokens and the webhook secret. **Keep it forever.** If it changes, stored credentials can no longer be read.

### 3b · Required secrets

```bash
firebase apphosting:secrets:set DATABASE_URL
```
Paste the Neon connection string from step 1.

```bash
firebase apphosting:secrets:set HALO_CRON_SECRET
```

```bash
firebase apphosting:secrets:set HALO_DATA_KEY
```

### 3c · Broker and price-feed secrets (listed in `apphosting.yaml`)

`apphosting.yaml` also lists `METAAPI_TOKEN` and the four Exness API values. Choose one:

- **You use these services:** set each one.

```bash
firebase apphosting:secrets:set METAAPI_TOKEN
```

```bash
firebase apphosting:secrets:set EXNESS_API_KEY
```

```bash
firebase apphosting:secrets:set EXNESS_API_SECRET
```

```bash
firebase apphosting:secrets:set EXNESS_GATEWAY_URL
```

```bash
firebase apphosting:secrets:set EXNESS_ACCOUNT_ID
```

- **You trade only through the free HALO Bridge EA in your own MT5:** open `apphosting.yaml` and comment out (put `#` in front of) the `METAAPI_TOKEN` block and the four `EXNESS_*` blocks. Then you don't need those secrets.

### 3d · Optional secrets and settings

- **HALO AI chat (Claude):** create a key at console.anthropic.com, then:

```bash
firebase apphosting:secrets:set ANTHROPIC_API_KEY
```

  Then **uncomment** the three `ANTHROPIC_API_KEY` lines in `apphosting.yaml`.

- **Card payments:** set `PAYSTACK_SECRET_KEY`, and/or `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_HASH`, the same way. Add a matching block for each to the `env:` list in `apphosting.yaml`:

```yaml
  - variable: PAYSTACK_SECRET_KEY
    secret: PAYSTACK_SECRET_KEY
    availability: [RUNTIME]
```

- **Your public address**, used in e-mail links and payment return URLs. Add it as a plain (non-secret) variable in `apphosting.yaml` once you know your domain (step 6):

```yaml
  - variable: PUBLIC_BASE_URL
    value: https://app.yourdomain.com
```

> When you set a secret through the CLI, it asks to grant your App Hosting backend access. Answer **yes**. If you create the backend later (step 4), run `firebase apphosting:secrets:grantaccess SECRET_NAME --backend halo-autotrader` for each secret.

---

## Step 4 · Create the App Hosting backend and deploy

### Option A: from GitHub (recommended, deploys on every push)

```bash
firebase apphosting:backends:create --backend halo-autotrader --primary-region us-central1
```

The CLI walks you through connecting GitHub. Choose this repository, the **root directory `/`** and your live branch (for example `main`). The first rollout starts automatically.

### Option B: upload from your computer

```bash
npm run deploy:firebase
```

### What the build does

`npm run build:apphosting` switches Prisma to PostgreSQL, creates or updates all tables in your database, builds Next.js and starts `node .next/standalone/server.js`. Follow it in Firebase console → **App Hosting → halo-autotrader → Rollouts**.

### Check it

Open (replace the parts in angle brackets):

`https://halo-autotrader--<project-id>.<region>.hosted.app/api/health`

You should see JSON with `"ok": true` and `"db": true`.

---

## Step 5 · Seed the plans and create your Super Admin

The new database is empty: no pricing plans and no administrator. Run the one-time setup **from your computer against the production database**.

1. Switch your local Prisma client to PostgreSQL for this one job:

```bash
DATABASE_PROVIDER=postgresql node scripts/deploy/prisma-provider.mjs && npx prisma generate
```

2. Run the setup with the production connection string. Type the URL into the command only on your own computer, and don't paste it anywhere else:

```bash
DATABASE_URL='postgresql://…your Neon URL…' npx tsx scripts/commerce-setup.ts --admin-email you@yourdomain.com
```

   It seeds the four plans (Starter, Pro, Elite, Ultimate), creates your Super Administrator, and **prints a generated password once**. Save it in your password manager straight away.

3. Switch your local project back to SQLite:

```bash
git checkout prisma/schema.prisma && npx prisma generate
```

4. Sign in at your app's `/login` with that e-mail and password, then turn on two-factor sign-in.

---

## Step 6 · Put your domain on Cloudflare

1. In Cloudflare, click **Add a site**, enter `yourdomain.com` and choose a plan (Free is fine).
2. At your domain registrar, replace the nameservers with the two Cloudflare gives you. Wait until Cloudflare says the site is **Active**.
3. In Firebase console → **App Hosting → halo-autotrader → Settings → Domains**, click **Add custom domain** and enter `app.yourdomain.com`. Firebase shows the DNS records to create.
4. In Cloudflare → **DNS → Records**, add exactly those records, with the proxy set to **DNS only (grey cloud)**.
5. Wait until Firebase shows the domain as **Connected** and the certificate as **issued**. This can take up to an hour. Firebase can't verify the domain through Cloudflare's proxy, which is why it starts grey.
6. Switch the record to **Proxied (orange cloud)**.
7. Cloudflare → **SSL/TLS → Overview**: set the mode to **Full (strict)**. "Flexible" causes endless redirect loops.
8. Cloudflare → **Caching → Cache Rules → Create rule**: when *URI Path starts with* `/api/`, set **Bypass cache**. Trading state and the live event stream must never be cached.
9. Optional, under **Security**:
   - Turn on **Bot Fight Mode**.
   - Add a **rate-limiting rule** for `/api/auth/login`.
   - **Don't** put a challenge on `/api/webhook/*`, `/api/commerce/webhook/*` or `/api/bridge/mt5`. TradingView, Paystack, Flutterwave and your MT5 EA call these from servers and can't solve challenges.
10. If you added `PUBLIC_BASE_URL` in step 3d, set it to `https://app.yourdomain.com`, then commit and push (or run `npm run deploy:firebase`).

Check `https://app.yourdomain.com/api/health` again. It should return `"ok": true`.

---

## Step 7 · Deploy the Cloudflare keep-alive worker

This worker calls the app every minute so the bot engine never stalls.

1. Install it:

```bash
cd cloudflare/keepalive-worker && npm install
```

2. Open `cloudflare/keepalive-worker/wrangler.toml` and set:

```toml
APP_ORIGIN = "https://app.yourdomain.com"
```

3. Sign in to Cloudflare:

```bash
cd cloudflare/keepalive-worker && npx wrangler login
```

4. Store the same `HALO_CRON_SECRET` you created in step 3a:

```bash
cd cloudflare/keepalive-worker && npx wrangler secret put HALO_CRON_SECRET
```

5. Deploy it (from the project root):

```bash
npm run deploy:worker
```

6. Check: Cloudflare → **Workers & Pages → halo-keepalive → Logs** shows a call every minute. Opening the worker's URL shows the app's health JSON with `"ticked": true`.

---

## Step 8 · Point MT5 (HALO Bridge EA) at the live site

1. In MetaTrader 5 → **Tools → Options → Expert Advisors → Allow WebRequest for listed URL**, add `https://app.yourdomain.com`.
2. On the chart with **HALO_Bridge** attached, open **Inputs** and set **`HaloUrl`** to `https://app.yourdomain.com` (no trailing slash). Keep the same **PairingKey**.
3. In the live HALO app → **Brokers & MT5**, connect **MT5 · HALO Bridge EA** with that pairing key, then press **Test**. Use a **demo** account first.
4. TradingView alerts: update each alert's webhook URL to `https://app.yourdomain.com/api/webhook/...`, with the same path you use today.

---

## Step 9 · Final checks before real money

- [ ] `https://app.yourdomain.com/api/health` → `"ok": true`
- [ ] The pricing page shows the four plans, and you can sign in as Super Admin
- [ ] Admin → **Generate** a test complimentary licence and activate it on a second browser
- [ ] The dashboard shows a live price feed (the badge is not "SIMULATOR")
- [ ] Brokers & MT5 → **Test** passes from production (demo account)
- [ ] Alerts: Telegram/e-mail test messages arrive
- [ ] Run in **PAPER** mode on production for a while before switching to **LIVE**
- [ ] Admin → **Execution**: set the **live price guard** threshold (live orders are refused while it is "NOT SET")

---

## Updating the live site later

- **GitHub-connected:** commit and push to the live branch. App Hosting builds and rolls out automatically, and database tables update during the build.
- **Local upload:** `npm run deploy:firebase`.
- Roll out when **no trade is open**. The new instance replaces the old one, and the restart monitor restores open trades, but a quiet moment is safest.

## Never do this

- **Never raise `maxInstances` above 1** in `apphosting.yaml`. Two instances would run two bots on the same broker account.
- **Never change `HALO_DATA_KEY`** after go-live. Stored broker logins would become unreadable.
- **Never cache `/api/*`** on Cloudflare, and never put a challenge on the webhook or bridge paths.

## Troubleshooting

| Problem | Fix |
|---|---|
| Build fails: "secret … not found" | A secret listed in `apphosting.yaml` doesn't exist. Create it (step 3) or comment out its block. |
| Build fails at `prisma db push` | `DATABASE_URL` is wrong, or the database blocks outside connections. Use Neon/Supabase, or allow Cloud Build to reach Cloud SQL. |
| `/api/health` shows `"db": false` | Check `DATABASE_URL`, and make sure it ends with `?sslmode=require`. |
| Domain stuck at "Pending" in Firebase | The Cloudflare record must be **grey cloud** until the certificate is issued. |
| Endless redirects on your domain | Cloudflare SSL mode must be **Full (strict)**. |
| Pricing page is empty / can't sign in | Step 5 wasn't run against the production database. |
| MT5 EA shows a WebRequest alert | Add the exact `https://app.yourdomain.com` under Allow WebRequest, and set `HaloUrl` to it. |
| Worker URL shows `"ticked": false` | The worker's `HALO_CRON_SECRET` differs from the App Hosting secret. Set the same value in both. |
