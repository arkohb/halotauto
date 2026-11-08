// ForexFactory calendar: 429 cooldown + XML fallback (mocked fetch, no network)
//   npx tsx scripts/intel-feed-test.ts
let calls = 0;
let xmlAlsoLimited = false;
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const mdY = `${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${now.getUTCFullYear()}`;
const ev = (title: string, cur: string, impact: string, time: string) =>
  `<event><title><![CDATA[${title}]]></title><country>${cur}</country><date><![CDATA[${mdY}]]></date><time>${time}</time><impact>${impact}</impact><forecast>0.2%</forecast><previous>0.1%</previous></event>`;
const XML = `<?xml version="1.0" encoding="windows-1252"?><weeklyevents>${ev("CPI m/m", "USD", "High", "1:30pm")}${ev("Building Approvals m/m", "AUD", "Medium", "12:30am")}${ev("Bank Holiday", "JPY", "Holiday", "All Day")}</weeklyevents>`;

(globalThis as unknown as { fetch: (u: string) => Promise<Response> }).fetch = async (url: string) => {
  calls++;
  if (url.endsWith(".json")) return new Response("<html>Rate Limited</html>", { status: 429, headers: { "retry-after": "246" } });
  if (xmlAlsoLimited) return new Response("<html>Rate Limited</html>", { status: 429, headers: { "retry-after": "60" } });
  return new Response(XML, { status: 200 });
};

let fails = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`, c ? "" : JSON.stringify(extra ?? ""));
  if (!c) fails++;
};

async function main() {
  const { getCalendar, retryAfterToMs, parseFfXml } = await import("../src/lib/halo/intel");
  ok(retryAfterToMs("246") === 246_000, "Retry-After in seconds is understood");
  ok(Math.abs((retryAfterToMs(new Date(Date.now() + 50_000).toUTCString()) ?? 0) - 50_000) < 2000, "Retry-After as a date is understood");
  ok(retryAfterToMs("soon") === null, "a junk Retry-After is ignored");

  const rows = parseFfXml(XML);
  ok(rows.length === 3, "XML parser reads every event", rows.length);
  const cpi = rows.find((r) => r.title === "CPI m/m");
  ok(cpi?.date?.endsWith("T13:30:00.000Z") === true, "1:30pm reads as 13:30 UTC", cpi?.date);
  ok(rows.find((r) => r.title?.startsWith("Building"))?.date?.endsWith("T00:30:00.000Z") === true, "12:30am reads as 00:30 UTC");

  const r1 = await getCalendar("today", "all");
  ok(r1.ok && r1.events.length === 3, "JSON 429 → the XML variant of the same feed serves the events", r1);
  ok(/XML/.test(r1.note ?? ""), "the result says it came from the XML fallback");
  ok(r1.events.every((e) => e.actual === ""), "no actuals are invented on the XML path");
  const high = await getCalendar("today", "high", "USD");
  ok(high.events.length === 1 && high.events[0].title === "CPI m/m", "impact/currency filters still apply (news filter input)");

  const b = calls;
  const r2 = await getCalendar("today", "all", undefined, { force: true });
  ok(r2.ok && calls === b + 1, "force=1 re-fetches once; the rate-limited JSON URL is not hit again", { b, calls });

  xmlAlsoLimited = true;
  const r3 = await getCalendar("next_week", "high");
  ok(!r3.ok && r3.rateLimited === true && r3.events.length === 0, "both paths 429 → honest failure flagged rate-limited", r3);
  ok(typeof r3.retryIn === "number" && r3.retryIn > 100 && r3.retryIn <= 246, "retry window reported (from Retry-After)", r3.retryIn);
  const d = calls;
  const r4 = await getCalendar("next_week", "high", undefined, { force: true });
  ok(calls === d && !r4.ok, "during the cooldown even a forced refresh makes no outbound request", { d, calls });

  const e = calls;
  await Promise.all([getCalendar("this_week", "all", undefined, { force: true }), getCalendar("today", "all", undefined, { force: true })]);
  ok(calls - e <= 1, "parallel consumers share one in-flight request", calls - e);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
