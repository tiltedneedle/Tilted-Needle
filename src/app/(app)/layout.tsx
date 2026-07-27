import Sidebar from "@/components/Sidebar";
import { requireSession } from "@/lib/workspace";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

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
