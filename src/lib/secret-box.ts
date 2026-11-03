// ════════════════════════════════════════════════════════════════════════
//  SECRET BOX · encryption at rest for stored credentials
//
//  AES-256-GCM (node:crypto, authenticated: tampering or a wrong key fails
//  instead of returning garbage). The key comes ONLY from the server secret
//  HALO_DATA_KEY (32 bytes, base64 or hex) — never from the database or
//  the source code.
//
//  Stored format:  enc:v1:<keyId>:<iv>:<tag>:<ciphertext>   (base64url parts)
//  keyId = first 8 hex chars of SHA-256(key) → a wrong key is detected and
//  reported clearly, and future key rotation can tell keys apart.
//  Values without the prefix are legacy plaintext (read as-is) until the
//  one-off migration (scripts/encrypt-credentials.ts) seals them.
//
//  Never log plaintext or keys. Decrypted values stay on the server.
// ════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

const PREFIX = "enc:v1:";

export class SecretKeyError extends Error {}

/** the data key, or null when HALO_DATA_KEY is not set */
export function dataKey(): Buffer | null {
  const raw = String(process.env.HALO_DATA_KEY ?? "").trim();
  if (!raw) return null;
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SecretKeyError("HALO_DATA_KEY must be 32 bytes (base64 or 64 hex characters).");
  return key;
}

function keyIdOf(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function isSealed(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** encrypt; throws SecretKeyError when no valid key is configured (never stores plaintext) */
export function seal(plain: string): string {
  const key = dataKey();
  if (!key) throw new SecretKeyError("Server encryption key HALO_DATA_KEY is not configured — credentials cannot be saved.");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${PREFIX}${keyIdOf(key)}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/** decrypt a sealed value; legacy plaintext is returned unchanged. Throws SecretKeyError on a missing/wrong key or tampering. */
export function open(stored: string): string {
  if (!isSealed(stored)) return stored;
  const key = dataKey();
  if (!key) throw new SecretKeyError("Stored credentials are encrypted but HALO_DATA_KEY is not configured.");
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 4) throw new SecretKeyError("Encrypted value is malformed.");
  const [kid, ivB, tagB, ctB] = parts;
  if (kid !== keyIdOf(key)) throw new SecretKeyError("Stored credentials were encrypted with a different HALO_DATA_KEY.");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
    d.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ctB, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new SecretKeyError("Encrypted value failed authentication (wrong key or tampered data).");
  }
}

/** open() that never throws: null when the value cannot be decrypted */
export function tryOpen(stored: string): string | null {
  try {
    return open(stored);
  } catch {
    return null;
  }
}
