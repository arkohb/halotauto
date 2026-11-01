# Going live · Firebase App Hosting + Cloudflare

HALO is a full Next.js **server** app. The bot engine, scanner, sweep and the
global trade lock run inside one long-lived Node process. That shapes the setup:

| Piece | Runs on | Why |
|---|---|---|
| Next.js app + bot engine | **Firebase App Hosting** (Cloud Run) | Runs the Node server, API routes and the background engine loop |
| Database | **PostgreSQL** (Cloud SQL, Neon or Supabase) | Cloud Run's disk is wiped on every restart, so SQLite would lose the trade book |
| Domain, TLS, CDN, WAF | **Cloudflare** (DNS, proxied) | Your domain, edge caching for static files, DDoS/WAF in front of the app |
| Keep-alive tick | **Cloudflare Worker** with a cron trigger | Calls `/api/health?tick=1` every minute so the engine keeps advancing |

`apphosting.yaml` pins the app to **exactly one instance** (`minInstances: 1`,
`maxInstances: 1`). Never raise `maxInstances`: two instances would run two
bots against the same broker account.

> Cloudflare Pages / Workers cannot host the app itself. It needs Node APIs
> (Prisma, nodemailer, web-push, long-running timers) that the Workers
> runtime does not provide. Cloudflare sits in front of App Hosting instead.

---

## 1 · Database (PostgreSQL)

1. Create a Postgres database. Cloud SQL works; Neon and Supabase are simpler
   because the build container can reach them over the public internet.
2. Copy the connection string, for example:
   `postgresql://USER:PASSWORD@HOST:5432/halo?sslmode=require`

Local development keeps using SQLite (`db/custom.db`). The build script
`scripts/deploy/prisma-provider.mjs` switches the Prisma provider to
`postgresql` only inside the App Hosting build (`DATABASE_PROVIDER` is set in
`apphosting.yaml`). The build then runs `prisma db push`, which creates or
updates the tables, including the new EDGE tables.

## 2 · Firebase App Hosting

App Hosting needs the Blaze (pay-as-you-go) plan.

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
cp .firebaserc.example .firebaserc   # then put your project id in it
```

Create the secrets (the CLI prompts for each value and grants the backend access):

```bash
firebase apphosting:secrets:set DATABASE_URL
```

```bash
firebase apphosting:secrets:set HALO_CRON_SECRET
```

```bash
firebase apphosting:secrets:set ANTHROPIC_API_KEY
```

`ANTHROPIC_API_KEY` is the Claude API key that powers HALO's conversation
(voice and chat replies, journal insights). Create one at
console.anthropic.com → API keys. Without it the app runs, but HALO
answers questions with "no Claude API key is set".

Use a long random string for `HALO_CRON_SECRET`, for example from
`openssl rand -hex 32`.

Create the backend, connected to your GitHub repository (it deploys on every
push to the live branch):

```bash
firebase apphosting:backends:create --backend halo-autotrader --primary-region us-central1
```

Or deploy the local folder directly:

```bash
npm run deploy:firebase
```

When it finishes, open `https://<backend>--<project>.<region>.hosted.app/api/health`.
It should return `{"ok":true,"db":true,...}`.

### First admin account
Commercial mode is on (`HALO_COMMERCE=on`), so the app opens on `/login`.
Register through `/register` and promote that user to admin the same way you
do locally (for example with `scripts/license-mint.ts` run against the
production `DATABASE_URL`).

## 3 · Cloudflare (domain, TLS, proxy)

1. Add your domain to Cloudflare and switch the registrar's nameservers to
   the two Cloudflare gives you.
2. In the Firebase console → App Hosting → your backend → **Settings → Domains**,
   add `app.yourdomain.com`. Firebase shows the DNS records to create.
3. In Cloudflare **DNS**, add those records with the proxy set to
   **DNS only (grey cloud)** until Firebase shows the domain as connected and
   the certificate as issued. Firebase cannot verify the domain or issue the
   certificate through the proxy.
4. Then switch the record to **Proxied (orange cloud)**.
5. **SSL/TLS → Overview**: set the mode to **Full (strict)**. Flexible mode
   causes redirect loops.
6. **Caching → Cache Rules**: add a rule *"URI Path starts with `/api/`" →
   Bypass cache*. API responses, the trading state and the SSE event stream
   (`/api/bot/events`) must never be cached.
7. Optional, under **Security**: turn on Bot Fight Mode and add a WAF rate-limit
   rule on `/api/auth/login`. Don't put a challenge on `/api/webhook/*` or
   `/api/commerce/webhook/*`: TradingView, Paystack and Flutterwave call those
   server to server and can't solve challenges.

## 4 · Cloudflare keep-alive worker

```bash
cd cloudflare/keepalive-worker && npm install
```

Edit `wrangler.toml` and set `APP_ORIGIN` to your public URL, for example
`https://app.yourdomain.com`. Then:

```bash
cd cloudflare/keepalive-worker && npx wrangler login
```

```bash
cd cloudflare/keepalive-worker && npx wrangler secret put HALO_CRON_SECRET
```

```bash
npm run deploy:worker
```

Use the same `HALO_CRON_SECRET` value as in step 2. In the worker's dashboard,
**Logs** shows a call every minute. Opening the worker URL in a browser
returns the app's health JSON with `"ticked": true`.

## 5 · Checklist before trading real money

- [ ] `/api/health` returns `ok: true` through the Cloudflare domain
- [ ] Ask HALO a question in Voice Command — it answers (Claude key works)
- [ ] Logged in, the dashboard shows a live price feed (not "simulator")
- [ ] Brokers & MT5: the broker connection test passes from production
- [ ] HALO EDGE → Capital Guardian limits are set to values you accept
- [ ] Run **EDGE vs baseline** on your market before switching EDGE layers on
- [ ] Trade in PAPER mode for a while on production before switching to LIVE

## Files

| File | Purpose |
|---|---|
| `apphosting.yaml` | Cloud Run sizing (1 instance), build/run commands, env + secrets |
| `firebase.json` | App Hosting backend id and upload ignore list |
| `scripts/deploy/prisma-provider.mjs` | SQLite locally → PostgreSQL in the hosted build |
| `src/app/api/health/route.ts` | Health check + secret-gated engine tick |
| `cloudflare/keepalive-worker/` | Cloudflare Cron Worker that calls the tick every minute |
