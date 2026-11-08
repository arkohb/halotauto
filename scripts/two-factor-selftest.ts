// Two-factor (TOTP + recovery codes) self-test — pure functions, no DB.
//   npx tsx scripts/two-factor-selftest.ts
import { base32Decode, base32Encode, createChallenge, finishChallenge, newRecoveryCodes, otpauthUri, stepOf, totpAt, consumeChallenge, verifyTotp } from "../src/lib/commerce/two-factor";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};

// RFC 6238 test vectors (SHA-1, secret "12345678901234567890"): 8-digit codes,
// HALO uses the last 6 digits of the same HOTP value.
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
const vectors: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
];
for (const [t, code8] of vectors) {
  ok(totpAt(rfcSecret, Math.floor(t / 30)) === code8.slice(-6), `RFC 6238 vector t=${t} → ${code8.slice(-6)}`);
}
ok(base32Decode(base32Encode(Buffer.from("halo-2fa"))).toString() === "halo-2fa", "base32 round trip");

const secret = base32Encode(Buffer.from("0123456789abcdefghij"));
const now = Date.UTC(2026, 10, 8, 12, 0, 15);
const step = stepOf(now);
ok(verifyTotp(secret, totpAt(secret, step), now, 0).ok, "current code accepted");
ok(verifyTotp(secret, totpAt(secret, step - 1), now, 0).ok, "previous 30 s code accepted (clock tolerance)");
ok(!verifyTotp(secret, totpAt(secret, step - 3), now, 0).ok, "code from 90 s ago rejected");
const used = verifyTotp(secret, totpAt(secret, step), now, 0);
ok(!verifyTotp(secret, totpAt(secret, step), now, used.step).ok, "the same code cannot be used twice (replay)");
ok(!verifyTotp(secret, "12345", now, 0).ok && !verifyTotp(secret, "abcdef", now, 0).ok, "malformed codes rejected");
ok(verifyTotp(secret, ` ${totpAt(secret, step).slice(0, 3)} ${totpAt(secret, step).slice(3)} `, now, 0).ok, "spaces in a typed code are ignored");

const rc = newRecoveryCodes();
ok(rc.plain.length === 10 && new Set(rc.plain).size === 10, "10 distinct recovery codes");
ok(rc.plain.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c)), "recovery code format XXXXX-XXXXX");
ok(rc.hashes.every((h) => /^[0-9a-f]{64}$/.test(h)) && !rc.hashes.some((h) => rc.plain.some((p) => h.includes(p))), "only hashes are kept, never the codes");

const uri = otpauthUri("admin@example.com", secret);
ok(uri.startsWith("otpauth://totp/HALO%203EL%3Aadmin%40example.com?secret=") && uri.includes("issuer=HALO%203EL") && uri.includes("period=30"), "otpauth URI for authenticator apps");

const ch = createChallenge("user-1", true);
let last = null;
for (let i = 0; i < 5; i++) last = consumeChallenge(ch);
ok(last?.userId === "user-1" && last.last === true, "a challenge allows 5 tries (the 5th is flagged as the last)");
ok(consumeChallenge(ch) === null, "a 6th try is refused — the password must be entered again");
const ch2 = createChallenge("user-2", false);
finishChallenge(ch2);
ok(consumeChallenge(ch2) === null, "a used challenge cannot be reused");
ok(consumeChallenge("forged-token") === null, "an unknown challenge is refused");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
