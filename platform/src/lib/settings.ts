import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const DEFAULT_SETTINGS = {
  siteName: "Kiosk",
  currency: "USD",
  adminEmail: "",
  announcement: "",
  signupEnabled: true,
  depositMin: 1000, // cents
  depositExpiryMinutes: 30,
  depositGraceMinutes: 60,
  depositUniqueCents: true,
  maxOpenDeposits: 3,
  resellerProgramEnabled: true,
  resellerFeePercent: 20,
  resellerHoldDays: 3,
  payoutMin: 5000, // cents
};

export type Settings = typeof DEFAULT_SETTINGS;

export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await db.select().from(settings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  return merged as Settings;
});

export async function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}
