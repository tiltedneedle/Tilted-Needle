import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import KioskClock from "@/components/KioskClock";

/**
 * Deliberately outside the (app) route group and requireSession(): a kiosk
 * is a shared device with no user login of its own, so gating this behind
 * the normal auth guard would defeat the point.
 */
export default async function KioskPage({
  params,
}: {
  params: Promise<{ deviceToken: string }>;
}) {
  const { deviceToken } = await params;
  const admin = createAdminClient();

  const { data: kiosk } = await admin
    .from("kiosks")
    .select("name, is_active")
    .eq("device_token", deviceToken)
    .maybeSingle();

  if (!kiosk || !kiosk.is_active) notFound();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-4">
      <KioskClock deviceToken={deviceToken} kioskName={kiosk.name} />
    </div>
  );
}
