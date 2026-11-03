// Credential encryption self-test — no DB, no network.
//   npx tsx scripts/secret-box-selftest.ts
import crypto from "node:crypto";
import { dataKey, isSealed, open, seal, SecretKeyError, tryOpen } from "../src/lib/secret-box";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const throwsKey = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof SecretKeyError;
  }
};

const keyA = crypto.randomBytes(32).toString("base64");
const keyB = crypto.randomBytes(32).toString("hex");
const secret = JSON.stringify({ apiToken: "test-token-0123456789", accountId: "101-001-123" });

delete process.env.HALO_DATA_KEY;
ok(dataKey() === null, "no key configured → dataKey() is null");
ok(throwsKey(() => seal(secret)), "no key → seal() refuses (never stores plaintext)");
ok(open(secret) === secret, "legacy plaintext is read as-is (pre-migration rows keep working)");

process.env.HALO_DATA_KEY = "too-short";
ok(throwsKey(() => dataKey()), "malformed key → rejected");

process.env.HALO_DATA_KEY = keyA;
const s1 = seal(secret);
const s2 = seal(secret);
ok(isSealed(s1) && s1.startsWith("enc:v1:"), "sealed format enc:v1:…");
ok(!s1.includes("test-token") && !s1.includes("101-001"), "ciphertext contains no plaintext");
ok(s1 !== s2, "fresh IV per encryption (same input → different output)");
ok(open(s1) === secret, "round trip (base64 key)");

const parts = s1.split(":");
const ct = Buffer.from(parts[5], "base64url");
ct[0] ^= 0x01;
const tampered = [...parts.slice(0, 5), ct.toString("base64url")].join(":");
ok(throwsKey(() => open(tampered)), "tampered ciphertext → rejected (GCM authentication)");
const badTag = [...parts.slice(0, 4), Buffer.alloc(16).toString("base64url"), parts[5]].join(":");
ok(throwsKey(() => open(badTag)), "forged auth tag → rejected");
ok(throwsKey(() => open("enc:v1:abc")), "malformed sealed value → rejected");

process.env.HALO_DATA_KEY = keyB;
ok(throwsKey(() => open(s1)), "wrong key → rejected with a clear error (no garbage)");
ok(tryOpen(s1) === null, "tryOpen returns null instead of throwing");
ok(open(seal(secret)) === secret, "round trip (hex key)");

delete process.env.HALO_DATA_KEY;
ok(throwsKey(() => open(s1)), "encrypted data but key missing → rejected");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
