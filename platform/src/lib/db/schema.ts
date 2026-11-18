import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const roleEnum = pgEnum("role", ["user", "reseller", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["pending_setup", "active", "banned"]);
export const resellerStatusEnum = pgEnum("reseller_status", ["none", "pending", "approved", "rejected"]);
export const productStatusEnum = pgEnum("product_status", ["draft", "active", "hidden"]);
export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "longtext",
  "number",
  "email",
  "url",
  "date",
  "boolean",
  "image",
  "file",
  "secret",
]);
export const fieldVisibilityEnum = pgEnum("field_visibility", ["public", "masked", "hidden"]);
export const itemStatusEnum = pgEnum("item_status", ["pending_review", "available", "sold", "refunded", "removed"]);
export const batchStatusEnum = pgEnum("batch_status", ["approved", "pending_review", "rejected"]);
export const orderStatusEnum = pgEnum("order_status", ["completed", "partially_refunded", "refunded"]);
export const refundStatusEnum = pgEnum("refund_status", ["pending", "approved", "rejected"]);
export const depositStatusEnum = pgEnum("deposit_status", [
  "awaiting_payment",
  "under_review",
  "needs_info",
  "approved",
  "rejected",
  "expired",
  "cancelled",
]);
export const txTypeEnum = pgEnum("tx_type", ["deposit", "purchase", "refund", "adjustment", "freeze", "unfreeze"]);
export const earningStatusEnum = pgEnum("earning_status", ["pending", "available", "reversed"]);
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "paid", "rejected"]);

const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("pending_setup"),

    // Two-factor authentication (TOTP). Secret is AES-GCM encrypted with APP_SECRET.
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    backupCodes: jsonb("backup_codes").$type<string[]>().notNull().default([]),
    recoveryPhraseHash: text("recovery_phrase_hash"),

    // Wallet (all amounts in cents)
    balance: money("balance"),
    frozen: money("frozen"),
    totalSpent: money("total_spent"),
    totalDeposited: money("total_deposited"),

    // Reseller program
    resellerStatus: resellerStatusEnum("reseller_status").notNull().default("none"),
    resellerApplication: text("reseller_application"),
    resellerNote: text("reseller_note"),
    earningsPending: money("earnings_pending"),
    earningsAvailable: money("earnings_available"),
    earningsPaid: money("earnings_paid"),
    payoutNetwork: text("payout_network"),
    payoutAddress: text("payout_address"),

    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token)
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ---------------------------------------------------------------- catalog */

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    summary: text("summary"),
    description: text("description"),
    imagePath: text("image_path"),
    status: productStatusEnum("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),

    price: money("price"), // default unit price, cents
    minBalance: money("min_balance"), // balance required before a purchase is allowed
    minQty: integer("min_qty").notNull().default(1),
    maxQty: integer("max_qty"),
    allowPick: boolean("allow_pick").notNull().default(true), // buyers may pick specific rows
    refundWindowHours: integer("refund_window_hours").notNull().default(24), // 0 = no refunds
    resellerEnabled: boolean("reseller_enabled").notNull().default(false),
    deliveryNote: text("delivery_note"), // printed at the top of downloads

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_category_idx").on(t.categoryId)],
);

/** Up to 10 configurable data columns per product, keyed A–J. */
export const productFields = pgTable(
  "product_fields",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // "A".."J"
    label: text("label").notNull(),
    type: fieldTypeEnum("type").notNull().default("text"),
    visibility: fieldVisibilityEnum("visibility").notNull().default("hidden"),
    filterable: boolean("filterable").notNull().default(false),
    required: boolean("required").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [uniqueIndex("product_fields_product_key_idx").on(t.productId, t.key)],
);

/** Bulk pricing: when quantity >= minQty, unitPrice applies. */
export const priceTiers = pgTable(
  "price_tiers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    minQty: integer("min_qty").notNull(),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("price_tiers_product_qty_idx").on(t.productId, t.minQty)],
);

export const uploadBatches = pgTable(
  "upload_batches",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    uploaderId: integer("uploader_id")
      .notNull()
      .references(() => users.id),
    isReseller: boolean("is_reseller").notNull().default(false),
    filename: text("filename").notNull(),
    totalRows: integer("total_rows").notNull().default(0),
    acceptedRows: integer("accepted_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    errors: jsonb("errors").$type<{ row: number; message: string }[]>().notNull().default([]),
    status: batchStatusEnum("status").notNull().default("approved"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("upload_batches_product_idx").on(t.productId)],
);

/** One sellable unit: a row of data (A–J) uploaded via CSV or added by hand. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    batchId: integer("batch_id").references(() => uploadBatches.id, { onDelete: "set null" }),
    sellerId: integer("seller_id").references(() => users.id), // null = house stock
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    dataHash: text("data_hash").notNull(),
    priceOverride: bigint("price_override", { mode: "number" }),
    status: itemStatusEnum("status").notNull().default("available"),
    orderId: integer("order_id"),
    buyerId: integer("buyer_id"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_product_status_idx").on(t.productId, t.status, t.id),
    index("inventory_batch_idx").on(t.batchId),
    index("inventory_seller_idx").on(t.sellerId),
    uniqueIndex("inventory_product_hash_live_idx")
      .on(t.productId, t.dataHash)
      .where(sql`${t.status} <> 'removed'`),
  ],
);

/* ----------------------------------------------------------------- orders */

export type FieldSnapshot = { key: string; label: string; type: string };

export const orders = pgTable(
  "orders",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    fields: jsonb("fields").$type<FieldSnapshot[]>().notNull(),
    deliveryNote: text("delivery_note"),
    quantity: integer("quantity").notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    refunded: money("refunded"),
    status: orderStatusEnum("status").notNull().default("completed"),
    createdAt: createdAt(),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    inventoryItemId: bigint("inventory_item_id", { mode: "number" }).notNull(),
    sellerId: integer("seller_id"),
    price: bigint("price", { mode: "number" }).notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    refundStatus: refundStatusEnum("refund_status"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const refundRequests = pgTable(
  "refund_requests",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" })
      .unique(),
    orderId: integer("order_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    status: refundStatusEnum("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_status_idx").on(t.status, t.createdAt)],
);

/* ----------------------------------------------------------------- wallet */

export const transactions = pgTable(
  "transactions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    type: txTypeEnum("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // signed change to available balance
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    frozenAfter: bigint("frozen_after", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    refType: text("ref_type"),
    refId: integer("ref_id"),
    actorId: integer("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("transactions_user_idx").on(t.userId, t.createdAt)],
);

/** Crypto wallets the admin publishes for manual deposits. */
export const paymentMethods = pgTable("payment_methods", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  asset: text("asset").notNull(), // USDT
  network: text("network").notNull(), // TRC20
  address: text("address").notNull(),
  memo: text("memo"),
  instructions: text("instructions"),
  rate: text("rate").notNull().default("1"), // USD value of 1 unit of the asset
  decimals: integer("decimals").notNull().default(2),
  minAmount: money("min_amount"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const deposits = pgTable(
  "deposits",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    methodId: integer("method_id").references(() => paymentMethods.id, { onDelete: "set null" }),
    // Snapshot of the wallet at creation so later edits never change instructions.
    methodName: text("method_name").notNull(),
    asset: text("asset").notNull(),
    network: text("network").notNull(),
    address: text("address").notNull(),
    memo: text("memo"),
    amount: bigint("amount", { mode: "number" }).notNull(), // cents the user expects to receive
    payAmount: text("pay_amount").notNull(), // exact amount of asset to send
    creditedAmount: bigint("credited_amount", { mode: "number" }),
    status: depositStatusEnum("status").notNull().default("awaiting_payment"),
    txHash: text("tx_hash"),
    receiptPath: text("receipt_path"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by"),
    adminNote: text("admin_note"),
    createdAt: createdAt(),
  },
  (t) => [index("deposits_user_idx").on(t.userId, t.createdAt), index("deposits_status_idx").on(t.status)],
);

export const depositMessages = pgTable(
  "deposit_messages",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    depositId: integer("deposit_id")
      .notNull()
      .references(() => deposits.id, { onDelete: "cascade" }),
    authorId: integer("author_id").notNull(),
    fromAdmin: boolean("from_admin").notNull().default(false),
    body: text("body").notNull(),
    attachmentPath: text("attachment_path"),
    createdAt: createdAt(),
  },
  (t) => [index("deposit_messages_deposit_idx").on(t.depositId)],
);

/* --------------------------------------------------------------- resellers */

export const resellerEarnings = pgTable(
  "reseller_earnings",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    resellerId: integer("reseller_id")
      .notNull()
      .references(() => users.id),
    orderItemId: integer("order_item_id").notNull().unique(),
    productName: text("product_name").notNull(),
    gross: bigint("gross", { mode: "number" }).notNull(),
    fee: bigint("fee", { mode: "number" }).notNull(),
    net: bigint("net", { mode: "number" }).notNull(),
    status: earningStatusEnum("status").notNull().default("pending"),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("earnings_reseller_idx").on(t.resellerId, t.status)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    resellerId: integer("reseller_id")
      .notNull()
      .references(() => users.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    network: text("network").notNull(),
    address: text("address").notNull(),
    status: payoutStatusEnum("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    adminNote: text("admin_note"),
    processedBy: integer("processed_by"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("payouts_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------- misc */

export const notifications = pgTable(
  "notifications",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    actorId: integer("actor_id"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductField = typeof productFields.$inferSelect;
export type PriceTier = typeof priceTiers.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type Category = typeof categories.$inferSelect;
