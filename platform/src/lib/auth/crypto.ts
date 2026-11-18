import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set to at least 32 characters");
  return s;
}

const encKey = () => createHash("sha256").update(`enc:${appSecret()}`).digest();
const macKey = () => createHash("sha256").update(`mac:${appSecret()}`).digest();

/** scrypt hash for passwords and recovery phrases, stored as `scrypt$salt$hash`. */
export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(value.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifySecret(value: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so unknown usernames can't be detected by timing.
    await scryptAsync(value, randomBytes(16), 64, SCRYPT);
    return false;
  }
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(value.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** AES-256-GCM encryption for secrets at rest (authenticator keys). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Keyed hash for high-entropy one-time values (backup codes). */
export function hmac(value: string): string {
  return createHmac("sha256", macKey()).update(value).digest("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Signed, expiring token: base64url(json).signature */
export function sign<T extends object>(payload: T, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function unsign<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(hmac(body), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    return data.exp < Date.now() ? null : data;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
