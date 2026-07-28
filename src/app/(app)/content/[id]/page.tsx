import { redirect } from "next/navigation";

/**
 * Video detail now lives on the consolidated dashboard (PRD §1.1.3), so this
 * route is a redirect rather than a page -- one canonical place to view or
 * edit a piece of content, not two that could drift apart.
 */
export default async function ContentDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/performance?video=${id}`);
}
