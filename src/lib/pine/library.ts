// ════════════════════════════════════════════════════════════════════════
//  BEST INDICATORS LIBRARY · boot-time seeder
//
//  Idempotently installs the curated ★ library (library-sources.ts) into
//  the PineStrategy table so every deployment ships with the best proven
//  indicators ready to trade — they appear in the Strategy Studio list
//  immediately, one click to attach to the chart and let the bot trade
//  them. Existing rows are NEVER touched (a trader may have edited their
//  copy); only missing entries are added, compiled through the REAL
//  compiler so they arrive with status "compiled".
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { compileAndSave } from "@/lib/strategy-store";
import { LIBRARY } from "./library-sources";

const g = globalThis as typeof globalThis & {
  __haloPineLibSeed?: Promise<void>;
};

/** Runs at most once per process (retried on the next poll if the DB is not ready yet). */
export function ensurePineLibrary(): Promise<void> {
  if (!g.__haloPineLibSeed) {
    g.__haloPineLibSeed = (async () => {
      try {
        const rows = await db.pineStrategy.findMany({ select: { name: true } });
        const have = new Set(rows.map((r) => r.name));
        for (const item of LIBRARY) {
          if (have.has(item.name)) continue;
          const { summary } = await compileAndSave({
            name: item.name,
            description: item.description,
            pineSource: item.source,
          });
          if (summary.status !== "compiled") {
            console.error(`[pine-library] "${item.name}" failed to compile:\n${summary.compileMsg}`);
          }
        }
      } catch (e) {
        // DB not ready / transient — reset so the next botState poll retries
        g.__haloPineLibSeed = undefined;
        throw e;
      }
    })();
  }
  return g.__haloPineLibSeed;
}
