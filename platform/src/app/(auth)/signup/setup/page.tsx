import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Card } from "@/components/ui";
import { encrypt, decrypt } from "@/lib/auth/crypto";
import { ensureTotpSecret } from "@/lib/auth/helpers";
import { getPreAuth } from "@/lib/auth/session";
import { generateTotpSecret, otpauthUri } from "@/lib/auth/totp";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { SetupWizard } from "./wizard";

export const metadata = { title: "Secure your account" };

export default async function SetupPage() {
  const pre = await getPreAuth("setup");
  if (!pre) redirect("/login");
  const [user] = await db.select().from(users).where(eq(users.id, pre.uid)).limit(1);
  if (!user || user.status === "banned") redirect("/login");

  const s = await getSettings();
  let qrSvg = "";
  let secret = "";
  if (!user.totpEnabled) {
    secret = decrypt(await ensureTotpSecret(user.id, encrypt(generateTotpSecret())));
    qrSvg = await QRCode.toString(otpauthUri(secret, user.username, s.siteName), {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#09090b", light: "#ffffff" },
    });
  }

  return (
    <Card className="p-6 sm:p-8">
      <SetupWizard
        siteName={s.siteName}
        username={user.username}
        totpEnabled={user.totpEnabled}
        hasPhrase={!!user.recoveryPhraseHash}
        qrSvg={qrSvg}
        secret={secret}
      />
    </Card>
  );
}
