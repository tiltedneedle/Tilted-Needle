import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/kiosk/clock
 * body: { deviceToken, pin, latitude?, longitude? }
 *
 * No Supabase session exists here -- a kiosk is a shared device with no
 * login of its own -- so this runs on the admin client and the entire trust
 * boundary is the kiosk_clock() function itself: a valid, active
 * device_token plus a PIN that hashes to a match. Hashing the PIN here
 * rather than sending it raw keeps a PIN from sitting in plaintext in any
 * request log between the device and this route.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const deviceToken = typeof body?.deviceToken === "string" ? body.deviceToken : null;
  const pin = typeof body?.pin === "string" ? body.pin : null;

  if (!deviceToken || !pin || !/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "A device token and a 4-8 digit PIN are required." }, { status: 400 });
  }

  const latitude = typeof body?.latitude === "number" ? body.latitude : null;
  const longitude = typeof body?.longitude === "number" ? body.longitude : null;

  const admin = createAdminClient();
  const pinHash = createHash("sha256").update(pin).digest("hex");

  const { data, error } = await admin.rpc("kiosk_clock", {
    p_device_token: deviceToken,
    p_pin_hash: pinHash,
    p_latitude: latitude,
    p_longitude: longitude,
  });

  if (error) {
    // Both failure modes (bad device, bad pin) return the same generic
    // message: distinguishing them would tell someone probing a shared
    // device whether a guessed PIN was merely wrong or the device itself
    // was the problem.
    return NextResponse.json({ error: "Could not clock in or out." }, { status: 401 });
  }

  const row = data?.[0];
  return NextResponse.json({ action: row?.action, entryId: row?.entry_id });
}
