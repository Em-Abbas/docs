# Kiosk — digital goods marketplace

A fast, minimal marketplace for selling configurable digital goods: license keys, gift cards, leads, accounts, files, images — anything that can be described as rows of data. Admins define each product's data columns, upload stock by CSV, and buyers download what they purchased as a Notepad `.txt` or a `.csv` file.

- **Stack:** Next.js 16 (App Router, Server Components, Server Actions) · React 19 · Tailwind CSS 4 · PostgreSQL · Drizzle ORM
- **Fast by default:** pages render on the server, so there's almost no client JavaScript and no client-side data fetching. Images are resized to WebP on upload.
- **No email required:** accounts use a username, password and mandatory authenticator app (TOTP).

---

## Features by phase

### Phase 1 — Accounts and security
- Sign up with **username, password, re-enter password**, then a guided setup:
  1. **Authenticator** — scan a QR code (or type the key), confirm with a 6-digit code.
  2. **Backup codes** — 10 single-use codes with **Download .txt** and copy.
  3. **Recovery phrase** — **create your own** or **generate a 12-word phrase** and download it.
- Login = password + authenticator code (or a backup code).
- **Forgot password** = username + recovery phrase.
- Security page: change password, regenerate backup codes, change phrase, reset authenticator, see and sign out sessions.
- Hardened: scrypt hashing, AES-256-GCM encrypted 2FA secrets, TOTP replay protection, rate limits, account lockout, audit log.

### Phase 2 — Product builder (admin)
- **Categories** and **products** with cover image, description, status (draft, active, hidden), featured flag.
- **Fields A–J** — up to 10 data columns per product. For each one:
  - **Label** (e.g. "Email"), **type** (text, long text, number, email, URL, date, yes/no, image, file, secret).
  - **Visibility:** *Public* (shown before purchase, can be a shop filter), *Masked* (partly shown, `jo•••@ex•••.com`), or *Hidden* (only after purchase).
  - **Filterable** and **required** flags.
- **Pricing:** unit price, **bulk tiers** (e.g. 10+ at $10.50, 50+ at $9.00), optional per-row price override.
- **Rules:** **minimum balance required before purchase**, min and max per order, refund window (hours), "let buyers pick specific items".
- **CSV template** per product (headers = field labels, plus a hint row). **Bulk upload** validates every row, skips duplicates, and keeps a history of rejected rows with reasons.
- **Inventory** browser: filter by status (available, sold, refunded, removed, pending review), search, add single items (with image/file upload), remove stock.

### Phase 3 — Storefront, orders and refunds
- **Overview:** available balance, frozen balance, total spent, total deposited, recent orders and deposits.
- **Shop:** category chips, search, sort, in-stock filter, **grid or list view**.
- **Product page:** bulk pricing table, stock, min-balance notice, public and masked preview of each item, filters on public fields, **pick exact items** with a live total, or **buy by quantity**.
- **Purchase engine:** one database transaction with row locks — an item can never be sold twice and a balance can never be overspent.
- **Orders:** full data with field titles, **download as `.txt` (Notepad) or `.csv`**, per-item **refund request** within the refund window.
- **Admin:** all orders, refund queue (approve credits the balance back and claws back reseller earnings).

### Phase 4 — Wallet and crypto deposits
- Admin adds **payment wallets** (asset, network — TRC20, ERC20, BEP20…, address, memo, minimum) with QR preview.
- User opens a deposit → sees the **exact amount** (unique cents added so every transfer matches one request), the **address and QR code**, a **countdown timer**, and a network warning.
- User uploads a **receipt** (image or PDF) and an optional transaction hash.
- **Admin is emailed** and sees it in the review queue with the receipt, a block explorer link and the user's history → **Approve** (editable credit amount), **Reject** (with reason) or **Request clarification** (message thread; user can reply with a file).
- Every balance change is written to a **ledger** (balance history).

### Phase 5 — Reseller program and payouts
- Users **apply**; admin approves.
- Resellers download a product's template and **upload stock**; admin **reviews each upload** before it goes live.
- Each sale of reseller stock earns the reseller the price minus the **platform fee** (default 20%). Earnings are **held** for N days (or the refund window) and are reversed if the item is refunded.
- Reseller sets a **payout wallet** (requires an authenticator code) and **requests a payout**; admin sends it manually and **marks it paid** with the transaction hash, or rejects it (funds return to the reseller).

### Phase 6 — Operations
- **Dashboard:** revenue (today, 7 and 30 days), deposits, users, money owed to users and resellers, low stock, work queues.
- **Users:** search, view, **credit, debit, freeze or unfreeze balance** (with reason), suspend, reset 2FA, clear lockout, grant admin.
- **Settings:** site name, admin email, announcement banner, sign-ups on or off, deposit rules, reseller fee, hold period, payout minimum.
- **Audit log** of admin and security actions. Docker deployment with automatic HTTPS.

---

## Run locally

Requirements: Node.js 20.9+ and PostgreSQL 14+.

```bash
cd platform
cp .env.example .env          # set DATABASE_URL, APP_SECRET, ADMIN_PASSWORD
npm install
npm run setup                 # migrate + create admin + demo catalog
npm run dev                   # http://localhost:3000
```

Log in as the admin from `.env`. On first login you'll set up the authenticator app. The admin panel is at `/admin`.

Set `SEED_DEMO=false` before `npm run setup` to skip the demo categories, products and wallets.

## Deploy (Docker)

On a server with Docker and a domain pointing at it:

```bash
cd platform
cp .env.example .env
# Set DOMAIN, POSTGRES_PASSWORD, APP_SECRET, APP_URL=https://your-domain,
# ADMIN_USERNAME, ADMIN_PASSWORD, SMTP_URL, and SEED_DEMO=false
docker compose up -d --build
```

This starts PostgreSQL, the app, and Caddy (automatic HTTPS). Migrations run on every start, and the first admin is created if none exists.

**After first login:** open **Admin → Payment wallets** and replace the placeholder addresses with your real wallet addresses.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_SECRET` | yes | 32+ random chars. Encrypts 2FA secrets and signs login steps. **Never change it after launch** — users would lose their authenticator. |
| `APP_URL` | yes | Public URL (`https://…`). Also enables secure cookies. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | first run | Creates the first admin |
| `SMTP_URL`, `MAIL_FROM` | recommended | Admin notification emails. Without them, emails are printed to the log. |
| `STORAGE_DIR` | no | Where uploads are stored (default `./storage`) |
| `CRON_SECRET` | no | Enables `GET /api/cron?key=…` for housekeeping |
| `SEED_DEMO` | no | `false` to skip demo data |

### Housekeeping

Expired deposits and matured reseller earnings are processed automatically when the relevant pages are opened. For punctual processing, call the cron endpoint every few minutes:

```bash
*/5 * * * * curl -fsS "https://your-domain/api/cron?key=$CRON_SECRET" > /dev/null
```

### Backups

Back up the PostgreSQL database (`pg_dump`) **and** the storage directory (product images, receipts, item files). In Docker those are the `pgdata` and `storage` volumes.

---

## How the money works

- All amounts are stored as integer **cents** (USD). Crypto deposits are converted with the wallet's rate (1 for stablecoins).
- `available` balance is spendable. `frozen` is held by an admin and can't be spent until released.
- Every change goes through one function (`src/lib/wallet.ts`) that locks the user row and writes a ledger entry, so balances always match the history.
- Reseller earnings are tracked separately (`pending` → `available` → `paid`).

## Project layout

```
platform/
├── drizzle/                 SQL migrations
├── scripts/                 migrate.mjs, seed.mjs
└── src/
    ├── app/
    │   ├── (auth)/          login, 2FA verify, signup wizard, password recovery
    │   ├── (app)/           overview, shop, orders, wallet, reseller, security, notifications
    │   ├── admin/           dashboard, products, categories, orders, refunds, deposits,
    │   │                    payment wallets, users, resellers, settings, audit log
    │   ├── files/ media/    private and public file serving
    │   └── api/cron/        housekeeping endpoint
    ├── components/          UI primitives, shell, small client widgets
    └── lib/
        ├── actions/         server actions (auth, catalog, shop, wallet, reseller, admin)
        ├── auth/            sessions, TOTP, crypto, rate limiting
        ├── db/              Drizzle schema and client
        ├── inventory.ts     CSV template, parsing, validation, masking
        ├── purchase.ts      atomic purchase engine
        └── wallet.ts        ledger
```

## Changing the schema

Edit `src/lib/db/schema.ts`, then:

```bash
npm run db:generate   # writes a new SQL migration to drizzle/
npm run db:migrate
```

## Scaling notes

- Rate limiting is in-memory (one app instance). For several instances, move it to Redis.
- Uploads are on local disk. For several instances, put `STORAGE_DIR` on shared storage or swap `src/lib/storage.ts` for S3.
