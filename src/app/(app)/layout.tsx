import TimezoneSync from "@/components/TimezoneSync";
import AppShell from "@/components/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { requireSession } from "@/lib/workspace";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Which pages a role may open is decided inside requireSession(): a client
  // user is held to /portal and a plain member to their allow-list
  // (lib/routeAccess.ts). It used to be decided here, and only here, which
  // did not hold: this layout is not rendered again when someone moves from
  // one page to another inside the app, so the check ran once per visit and
  // every page after the first was unguarded. Each page's own call to
  // requireSession() is what holds now; this one covers a plain visit.
  const session = await requireSession();

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
