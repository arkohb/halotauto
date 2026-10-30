// ════════════════════════════════════════════════════════════════════════
//  /api/halo/tts · neural text-to-speech for the HALO voice
//
//  Turns HALO's replies into NATURAL spoken audio (server-side neural TTS,
//  24 kHz WAV) instead of the browser's robotic OS voices. The client's
//  speak() calls this first and falls back to browser speechSynthesis only
//  if this route fails — so a network hiccup can never silence HALO.
//
//  Honesty rules:
//    • the audio returned is exactly the text requested — nothing invented
//    • failures return a real error; the client speaks the fallback voice
//    • replies are cached (text+voice+speed) so greetings replay instantly
//  Long replies are split at sentence boundaries (≤ 950 chars per chunk,
//  engine limit 1024) and stitched into one continuous WAV.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VOICES = new Set(["jam", "kazi", "xiaochen", "tongtong", "luodo", "douji", "chuichui"]);
const DEFAULT_VOICE = "jam";
const MAX_TEXT = 4000;
const CHUNK_MAX = 950;
const CHUNK_TIMEOUT_MS = 25_000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const CACHE_MAX = 48;

type CacheEntry = { buf: Buffer; at: number; seconds: number };
const cache = new Map<string, CacheEntry>();
const rateMap = new Map<string, number[]>();

// minimal structural type for the voice client we use (full SDK types are heavy)
type ZaiVoiceClient = {
  audio: {
    tts: {
      create: (args: { input: string; voice: string; speed: number; response_format: string; stream: boolean }) => Promise<Response>;
    };
  };
};
let zaiPromise: Promise<ZaiVoiceClient> | null = null;
async function getZai() {
  if (!zaiPromise) {
    zaiPromise = (async () => {
      const mod = (await import("z-ai-web-dev-sdk")).default;
      return mod.create();
    })();
  }
  return zaiPromise;
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (rateMap.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    rateMap.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(ip, arr);
  return false;
}

/** split into ≤CHUNK_MAX pieces at sentence boundaries (never mid-word) */
function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length <= CHUNK_MAX) {
      cur += s;
    } else {
      if (cur.trim()) chunks.push(cur.trim());
      if (s.length <= CHUNK_MAX) {
        cur = s;
      } else {
        // pathological single sentence — hard-split on word boundaries
        let rest = s;
        while (rest.length > CHUNK_MAX) {
          let cut = rest.lastIndexOf(" ", CHUNK_MAX);
          if (cut < CHUNK_MAX * 0.5) cut = CHUNK_MAX;
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut);
        }
        cur = rest;
      }
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** minimal RIFF reader — returns the payload of the named top-level chunk */
function riffChunk(buf: Buffer, id: string): Buffer | null {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const cid = buf.toString("ascii", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (off + 8 + len > buf.length) return null;
    if (cid === id) return buf.subarray(off + 8, off + 8 + len);
    off += 8 + len + (len % 2); // chunks are word-aligned
  }
  return null;
}

/** stitch same-format PCM WAV chunks into one continuous file */
function concatWav(parts: Buffer[]): Buffer {
  if (parts.length === 1) return parts[0];
  const fmt = riffChunk(parts[0], "fmt ");
  if (!fmt) throw new Error("upstream returned a non-RIFF audio file");
  const datas: Buffer[] = [];
  for (const p of parts) {
    const d = riffChunk(p, "data");
    if (!d) throw new Error("upstream audio chunk is malformed");
    datas.push(d);
  }
  const dataLen = datas.reduce((a, d) => a + d.length, 0);
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + (8 + fmt.length) + (8 + dataLen), 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  const dataHdrOff = 12 + 8 + fmt.length;
  header.write("data", dataHdrOff, "ascii");
  header.writeUInt32LE(dataLen, dataHdrOff + 4);
  return Buffer.concat([header, ...datas]);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "Too many voice requests — wait a moment." }, { status: 429 });
  }
  try {
    const body = (await req.json()) as { text?: unknown; voice?: unknown; speed?: unknown };
    const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
    if (!text) {
      return NextResponse.json({ ok: false, error: "No text to speak." }, { status: 400 });
    }
    const voice = typeof body.voice === "string" && VOICES.has(body.voice) ? body.voice : DEFAULT_VOICE;
    const speedRaw = Number(body.speed);
    const speed = Number.isFinite(speedRaw) ? Math.min(2, Math.max(0.5, speedRaw)) : 1;

    const key = `${voice}:${speed.toFixed(2)}:${text}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); // LRU refresh
      cache.set(key, hit);
      hit.at = Date.now();
      return NextResponse.json({
        ok: true,
        audio: hit.buf.toString("base64"),
        mime: "audio/wav",
        seconds: hit.seconds,
        cached: true,
      });
    }

    const zai = await getZai();
    const chunks = chunkText(text);
    // chunks are independent — generate in parallel so a long reply costs one
    // generation round-trip, not N (keeps the client's fetch timeout honest)
    const parts = await Promise.all(
      chunks.map(async (c) => {
        const resp = await Promise.race([
          zai.audio.tts.create({ input: c, voice, speed, response_format: "wav", stream: false }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("voice engine timed out")), CHUNK_TIMEOUT_MS)),
        ]);
        const ab = await (resp as Response).arrayBuffer();
        const buf = Buffer.from(new Uint8Array(ab));
        if (buf.length < 44) throw new Error("voice engine returned empty audio");
        return buf;
      })
    );
    const wav = concatWav(parts);
    // data bytes → seconds: byteRate sits at offset 8 inside the fmt payload
    const byteRate = riffChunk(wav, "fmt ")?.readUInt32LE(8) ?? 48000;
    const seconds = Math.round((wav.length / byteRate) * 10) / 10;

    cache.set(key, { buf: wav, at: Date.now(), seconds });
    while (cache.size > CACHE_MAX) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      cache.delete(oldest[0]);
    }

    return NextResponse.json({
      ok: true,
      audio: wav.toString("base64"),
      mime: "audio/wav",
      seconds,
      cached: false,
    });
  } catch (e) {
    console.error("[halo/tts] error:", (e as Error).message);
    return NextResponse.json(
      { ok: false, error: `The neural voice engine could not generate audio (${(e as Error).message}).` },
      { status: 502 }
    );
  }
}
