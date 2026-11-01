// HALO keep-alive · Cloudflare Cron Trigger → /api/health?tick=1
interface Env {
  APP_ORIGIN: string;
  HALO_CRON_SECRET: string;
}

async function tick(env: Env): Promise<Response> {
  return fetch(`${env.APP_ORIGIN}/api/health?tick=1`, {
    headers: { "x-halo-cron": env.HALO_CRON_SECRET, "cache-control": "no-store" },
  });
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      tick(env).then(async (r) => {
        if (!r.ok) console.error(`keep-alive tick failed: HTTP ${r.status} ${await r.text()}`);
      })
    );
  },
  // manual check: GET the worker URL → returns the app's health JSON
  async fetch(_req: Request, env: Env): Promise<Response> {
    const r = await tick(env);
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  },
};
