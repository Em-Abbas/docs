import { readStored } from "@/lib/storage";

/** Public images (product covers, preview images). Immutable, cached for a year. */
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+\.(webp|png|jpg|gif)$/.test(name)) return new Response("Not found", { status: 404 });
  const file = await readStored(`public/${name}`);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
