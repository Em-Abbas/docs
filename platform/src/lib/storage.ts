import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

export type UploadKind = "image" | "receipt" | "item";

const LIMITS: Record<UploadKind, number> = {
  image: 8 * 1024 * 1024,
  receipt: 8 * 1024 * 1024,
  item: 25 * 1024 * 1024,
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
};

function sniff(buf: Buffer): "png" | "jpg" | "webp" | "gif" | "pdf" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  if (buf.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  return null;
}

export class UploadError extends Error {}

const isFile = (v: unknown): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && "size" in v;

/** Returns a storage key such as `public/ab12.webp` or `receipts/cd34.pdf`, or null when no file was sent. */
export async function saveUpload(input: FormDataEntryValue | null, kind: UploadKind): Promise<string | null> {
  if (!isFile(input) || input.size === 0) return null;
  if (input.size > LIMITS[kind]) throw new UploadError(`File is too large (max ${LIMITS[kind] / 1024 / 1024} MB)`);
  const buf = Buffer.from(await input.arrayBuffer());
  const id = randomBytes(16).toString("hex");

  if (kind === "image") {
    const type = sniff(buf);
    if (!type || type === "pdf") throw new UploadError("Upload a PNG, JPG, WEBP or GIF image");
    const sharp = (await import("sharp")).default;
    const out = await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return write(`public/${id}.webp`, out);
  }
  if (kind === "receipt") {
    const type = sniff(buf);
    if (!type) throw new UploadError("Receipt must be an image (PNG, JPG, WEBP) or a PDF");
    return write(`receipts/${id}.${type}`, buf);
  }
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  return write(`items/${id}-${safeName}`, buf);
}

async function write(key: string, data: Buffer): Promise<string> {
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function readStored(key: string): Promise<{ data: Buffer; type: string; size: number } | null> {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) return null;
  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
    const ext = path.extname(full).slice(1).toLowerCase();
    return { data: await readFile(full), type: MIME[ext] ?? "application/octet-stream", size: info.size };
  } catch {
    return null;
  }
}

/** Public URL for a storage key. Private keys go through access-checked routes. */
export function fileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith("public/")) return `/media/${key.slice(7)}`;
  return `/files/${key}`;
}
