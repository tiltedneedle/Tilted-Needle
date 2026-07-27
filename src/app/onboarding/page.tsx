import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceForm from "@/components/WorkspaceForm";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm animate-rise">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Create a workspace
        </h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          Workspaces keep clients, projects, and tracked time fully separate.
        </p>

        <WorkspaceForm />
      </div>
    </div>
  );
}
