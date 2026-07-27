import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Sidebar from "@/components/Sidebar";
import { requireSession } from "@/lib/workspace";

/** The only route a client-role user is meant to reach. */
const CLIENT_ALLOWED = ["/portal"];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  // RLS already returns nothing to a client user on staff routes, so this is
  // about not showing them an empty Reports page -- defence in depth, not the
  // boundary itself.
  if (session.active.role === "client") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const allowed = CLIENT_ALLOWED.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (pathname && !allowed) redirect("/portal");
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        workspaces={session.workspaces}
        active={session.active}
        fullName={session.fullName}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
