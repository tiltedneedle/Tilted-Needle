import { redirect } from "next/navigation";
import { headers } from "next/headers";
import TimezoneSync from "@/components/TimezoneSync";
import AppShell from "@/components/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { requireSession } from "@/lib/workspace";
import { canManage } from "@/lib/types";

/** The only route a client-role user is meant to reach. */
const CLIENT_ALLOWED = ["/portal"];

/**
 * Where a plain member can go: their own day-to-day surface. Everything
 * else -- the performance dashboards, billing, workspace admin -- is
 * management's. An allow-list rather than a block-list, so any page added
 * later is manager-only until deliberately opened up.
 */
const MEMBER_ALLOWED = [
  "/home",
  "/todos",
  "/training",
  "/guidelines",
  "/track",
  "/timesheet",
  "/dashboard",
  "/time-off",
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const pathname = (await headers()).get("x-pathname") ?? "";

  // RLS already returns nothing to a client user on staff routes, so this is
  // about not showing them an empty Reports page -- defence in depth, not the
  // boundary itself.
  if (session.active.role === "client") {
    const allowed = CLIENT_ALLOWED.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (pathname && !allowed) redirect("/portal");
  } else if (!canManage(session.active.role)) {
    // Same defence for plain members: the database write layer is already
    // manager-gated, but pages like the Content dashboard would still show a
    // member everyone else's scores -- so their world is the allow-list.
    const allowed = MEMBER_ALLOWED.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (pathname && !allowed) redirect("/home");
  }

  return (
    <ToastProvider>
      {/* Renders nothing; reports the browser's zone when it differs from what
          is stored, so a settled user costs no requests. Display only -- day
          boundaries stay on the workspace zone. */}
      <TimezoneSync stored={session.timezone} />
      <AppShell
        workspaces={session.workspaces}
        active={session.active}
        fullName={session.fullName}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
