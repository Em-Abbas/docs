// Creates the first admin account and (optionally) demo catalog data.
// Usage: npm run db:seed   (reads ADMIN_USERNAME / ADMIN_PASSWORD / SEED_DEMO)
import { createHash, randomBytes, randomInt, scryptSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

try {
  process.loadEnvFile();
} catch {
  /* use real environment */
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const hashSecret = (value) => {
  const salt = randomBytes(16);
  const hash = scryptSync(value.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", salt.toString("base64"), hash.toString("base64")].join("$");
};
// Must match hashItemData() in src/lib/inventory.ts
const hashItem = (data) =>
  createHash("sha256")
    .update(JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]])))
    .digest("hex");

/* ---------------------------------------------------------------- admin */
const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD;
const [existing] = await sql`select id from users where role = 'admin' limit 1`;
if (existing) {
  console.log("• Admin already exists — skipping admin creation");
} else {
  if (!password || password.length < 8) {
    console.error("Set ADMIN_PASSWORD (8+ characters) to create the first admin");
    process.exit(1);
  }
  // Admin is active but has no authenticator yet: first login walks through 2FA setup.
  await sql`insert into users (username, password_hash, role, status) values (${username}, ${hashSecret(password)}, 'admin', 'active')`;
  console.log(`✓ Admin "${username}" created — log in to set up two-factor authentication`);
}

/* ----------------------------------------------------------------- demo */
const [{ n: productCount }] = await sql`select count(*)::int as n from products`;
if (process.env.SEED_DEMO !== "false" && productCount === 0) {
  const storage = path.resolve(process.env.STORAGE_DIR ?? "./storage");
  mkdirSync(path.join(storage, "public"), { recursive: true });

  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    /* images are optional */
  }
  const makeImage = async (hueA, hueB, label) => {
    if (!sharp) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hueA},70%,62%)"/><stop offset="1" stop-color="hsl(${hueB},70%,38%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><text x="48" y="540" font-family="Helvetica,Arial,sans-serif" font-size="44" font-weight="700" fill="rgba(255,255,255,.92)">${label}</text></svg>`;
    const name = `${randomBytes(12).toString("hex")}.webp`;
    writeFileSync(path.join(storage, "public", name), await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer());
    return `public/${name}`;
  };

  const cat = async (name, slug, sort) =>
    (await sql`insert into categories (name, slug, sort_order) values (${name}, ${slug}, ${sort}) returning id`)[0].id;
  const software = await cat("Software licenses", "software-licenses", 1);
  const gift = await cat("Gift cards", "gift-cards", 2);
  const leads = await cat("B2B leads", "b2b-leads", 3);
  const assets = await cat("Digital assets", "digital-assets", 4);

  const product = async (p, fields, tiers, rows) => {
    const [{ id }] = await sql`
      insert into products (category_id, name, slug, summary, description, image_path, status, featured, price, min_balance, refund_window_hours, delivery_note, reseller_enabled)
      values (${p.category}, ${p.name}, ${p.slug}, ${p.summary}, ${p.description}, ${p.image}, 'active', ${p.featured ?? false}, ${p.price}, ${p.minBalance ?? 0}, ${p.refund ?? 24}, ${p.note ?? null}, ${p.reseller ?? false})
      returning id`;
    for (const f of fields) {
      await sql`insert into product_fields (product_id, key, label, type, visibility, filterable, required)
        values (${id}, ${f.key}, ${f.label}, ${f.type}, ${f.visibility}, ${f.filterable ?? false}, ${f.required ?? false})`;
    }
    for (const t of tiers) await sql`insert into price_tiers (product_id, min_qty, unit_price) values (${id}, ${t[0]}, ${t[1]})`;
    const [{ id: batch }] = await sql`insert into upload_batches (product_id, uploader_id, filename, total_rows, accepted_rows)
      values (${id}, (select id from users where role='admin' order by id limit 1), 'demo-seed.csv', ${rows.length}, ${rows.length}) returning id`;
    const values = rows.map((data) => ({ product_id: id, batch_id: batch, data, data_hash: hashItem(data) }));
    await sql`insert into inventory_items ${sql(values, "product_id", "batch_id", "data", "data_hash")}`;
  };

  const pick = (arr) => arr[randomInt(arr.length)];
  const key = () => Array.from({ length: 5 }, () => randomBytes(3).toString("hex").slice(0, 5).toUpperCase()).join("-");

  await product(
    {
      category: software,
      name: "Windows 11 Pro — Retail key",
      slug: "windows-11-pro-retail",
      summary: "Genuine retail activation key, lifetime license.",
      description: "Retail license key for Windows 11 Pro. Delivered instantly after purchase together with the activation guide.",
      image: await makeImage(210, 250, "Windows 11 Pro"),
      featured: true,
      price: 1200,
      note: "Activate within 30 days. Contact support if a key fails to activate.",
      reseller: true,
    },
    [
      { key: "A", label: "License key", type: "secret", visibility: "hidden", required: true },
      { key: "B", label: "Edition", type: "text", visibility: "public", filterable: true },
      { key: "C", label: "Region", type: "text", visibility: "public", filterable: true },
      { key: "D", label: "Activation guide", type: "url", visibility: "hidden" },
    ],
    [
      [10, 1050],
      [50, 900],
    ],
    Array.from({ length: 40 }, () => ({ A: key(), B: pick(["Pro", "Pro N"]), C: pick(["Global", "EU", "US"]), D: "https://example.com/activate" })),
  );

  await product(
    {
      category: gift,
      name: "Steam Wallet — $20",
      slug: "steam-wallet-20",
      summary: "$20 digital gift card code.",
      description: "Redeem in your Steam client under Account → Add funds.",
      image: await makeImage(200, 230, "Gift card $20"),
      price: 1850,
      refund: 12,
    },
    [
      { key: "A", label: "Code", type: "secret", visibility: "hidden", required: true },
      { key: "B", label: "Region", type: "text", visibility: "public", filterable: true },
      { key: "C", label: "Expires", type: "date", visibility: "public" },
    ],
    [[5, 1800]],
    Array.from({ length: 25 }, () => ({ A: key(), B: pick(["US", "EU", "UK"]), C: "2027-12-31" })),
  );

  const companies = ["Northwind", "Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Stark", "Wayne", "Wonka", "Tyrell", "Cyberdyne"];
  const first = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Ethan", "Ivy", "Lucas", "Ella", "Omar", "Sara", "Yuki"];
  const last = ["Hart", "Reed", "Cole", "Lane", "Park", "Shaw", "Nash", "Ross", "Kim", "Diaz", "Khan", "Ford"];
  await product(
    {
      category: leads,
      name: "Verified B2B leads — SaaS founders",
      slug: "b2b-leads-saas-founders",
      summary: "Opt-in founder contacts, verified in the last 30 days.",
      description: "Each lead includes company, industry, size and a verified business contact. Contact details unlock after purchase.",
      image: await makeImage(150, 190, "B2B leads"),
      featured: true,
      price: 120,
      minBalance: 2500,
      refund: 48,
      reseller: true,
    },
    [
      { key: "A", label: "Company", type: "text", visibility: "public", required: true },
      { key: "B", label: "Industry", type: "text", visibility: "public", filterable: true },
      { key: "C", label: "Country", type: "text", visibility: "public", filterable: true },
      { key: "D", label: "Employees", type: "number", visibility: "public" },
      { key: "E", label: "Contact name", type: "text", visibility: "masked" },
      { key: "F", label: "Email", type: "email", visibility: "masked", required: true },
      { key: "G", label: "Phone", type: "text", visibility: "hidden" },
      { key: "H", label: "LinkedIn", type: "url", visibility: "hidden" },
    ],
    [
      [100, 90],
      [500, 70],
    ],
    Array.from({ length: 120 }, (_, i) => {
      const c = `${pick(companies)} ${pick(["Labs", "Cloud", "AI", "Systems", "Works", "HQ"])} ${i + 1}`;
      const fn = pick(first);
      const ln = pick(last);
      return {
        A: c,
        B: pick(["Fintech", "HR Tech", "DevTools", "Marketing", "Health"]),
        C: pick(["US", "UK", "DE", "CA", "AE"]),
        D: String(pick([5, 12, 25, 48, 90, 150])),
        E: `${fn} ${ln}`,
        F: `${fn.toLowerCase()}@${c.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
        G: `+1 555 ${String(randomInt(1000000)).padStart(7, "0")}`,
        H: `https://linkedin.example/in/${fn.toLowerCase()}-${ln.toLowerCase()}-${i}`,
      };
    }),
  );

  const photoRows = [];
  for (let i = 0; i < 8; i++) {
    const preview = await makeImage(20 + i * 40, 60 + i * 40, `Workspace #${i + 1}`);
    photoRows.push({
      A: preview ? `/media/${preview.slice(7)}` : "",
      B: `Minimal workspace #${i + 1}`,
      C: pick(["4K", "6K", "8K"]),
      D: `https://files.example/download/${randomBytes(8).toString("hex")}`,
    });
  }
  await product(
    {
      category: assets,
      name: "Stock photos — Minimal workspaces",
      slug: "stock-photos-minimal-workspaces",
      summary: "High-resolution photos with a commercial license.",
      description: "Pick the exact photos you want from the previews. Download links unlock after purchase.",
      image: await makeImage(30, 330, "Stock photos"),
      price: 400,
      refund: 0,
    },
    [
      { key: "A", label: "Preview", type: "image", visibility: "public" },
      { key: "B", label: "Title", type: "text", visibility: "public", required: true },
      { key: "C", label: "Resolution", type: "text", visibility: "public", filterable: true },
      { key: "D", label: "Download link", type: "url", visibility: "hidden", required: true },
    ],
    [],
    photoRows,
  );

  await sql`insert into payment_methods (name, asset, network, address, instructions, rate, decimals, min_amount, sort_order) values
    ('USDT · TRON', 'USDT', 'TRC20', 'T-REPLACE-WITH-YOUR-TRC20-ADDRESS', 'Send USDT on the TRON (TRC20) network only.', '1', 2, 1000, 1),
    ('USDT · Ethereum', 'USDT', 'ERC20', '0xREPLACE-WITH-YOUR-ERC20-ADDRESS', 'Send USDT on the Ethereum (ERC20) network only. Network fees are paid by you.', '1', 2, 5000, 2)`;

  console.log("✓ Demo catalog, inventory and payment wallets created");
}

await sql.end();
