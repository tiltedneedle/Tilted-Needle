import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import CoursePlayer from "@/components/CoursePlayer";
import TrainingAdmin from "@/components/TrainingAdmin";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/workspace";
import { loadMemberOptions } from "@/lib/dashboards";
import { canManage, one, type TrainingModule, type TrainingVideo } from "@/lib/types";

/**
 * One course. For a learner: the sequential player -- videos unlock in
 * order, the next one only after marking the current complete. For a
 * manager: the same player (nothing locked, for preview) plus the
 * management panel -- videos, assignments, per-person progress.
 *
 * RLS does the access control: a member who was never assigned this module
 * gets no row back and lands on 404, not an empty shell.
 */
export default async function TrainingModulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const ws = session.active.id;
  const manages = canManage(session.active.role);

  const { data: moduleRow } = await supabase
    .from("training_modules")
    .select("id, workspace_id, title, description, sort_order, is_archived")
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  const trainingModule = moduleRow as TrainingModule | null;
  if (!trainingModule || (trainingModule.is_archived && !manages)) notFound();

  const { data: videoRows } = await supabase
    .from("training_videos")
    .select("id, module_id, title, youtube_url, sort_order, created_at")
    .eq("module_id", id)
    .order("sort_order")
    .order("created_at");
  const videos = (videoRows ?? []) as TrainingVideo[];

  // RLS scopes this to the caller's own rows unless they manage.
  const { data: doneRows } = videos.length
    ? await supabase
        .from("training_completions")
        .select("video_id, user_id, completed_at")
        .in("video_id", videos.map((v) => v.id))
    : { data: [] };
  const completions = (doneRows ?? []) as {
    video_id: string;
    user_id: string;
    completed_at: string;
  }[];
  const myDone = new Set(
    completions.filter((c) => c.user_id === session.userId).map((c) => c.video_id),
  );

  // A member can only see the module because they hold an assignment; a
  // manager sees everything, assigned or not, so their own assignment has
  // to be looked up -- it decides whether "Mark as completed" applies to
  // them (RLS refuses completions without an assignment).
  let selfAssigned = !manages;

  let admin: React.ReactNode = null;
  if (manages) {
    const [assignRes, memberOptions] = await Promise.all([
      supabase
        .from("training_assignments")
        // Explicit FK: this table points at profiles twice (user_id and
        // assigned_by), and a bare profiles(...) embed is rejected by
        // PostgREST as ambiguous -- which this page was silently swallowing
        // as "no assignments".
        .select("id, module_id, user_id, profile:profiles!training_assignments_user_id_fkey(full_name)")
        .eq("module_id", id),
      loadMemberOptions(supabase, ws),
    ]);
    type AssignRow = {
      id: string;
      user_id: string;
      profile: { full_name: string | null } | { full_name: string | null }[] | null;
    };
    const assignments = ((assignRes.data ?? []) as unknown as AssignRow[]).map((a) => ({
      id: a.id,
      userId: a.user_id,
      name: one(a.profile)?.full_name ?? "Unknown",
    }));
    selfAssigned = assignments.some((a) => a.userId === session.userId);
    admin = (
      <TrainingAdmin
        workspaceId={ws}
        module={trainingModule}
        videos={videos}
        assignments={assignments}
        completions={completions}
        members={memberOptions}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link
        href="/training"
        className="mb-3 inline-block text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        ← Training
      </Link>
      <PageHeader title={trainingModule.title} subtitle={trainingModule.description ?? undefined} />

      <CoursePlayer
        workspaceId={ws}
        moduleId={trainingModule.id}
        videos={videos}
        myDone={[...myDone]}
        canManage={manages}
        selfAssigned={selfAssigned}
      />

      {admin}
    </div>
  );
}
