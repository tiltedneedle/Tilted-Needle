import { redirect } from "next/navigation";

/**
 * Performance is no longer its own page: everything -- content AND people --
 * lives on /content now (PRD v0.5). Straight to the right filter there.
 */
export default async function PerformanceRedirect({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; video?: string; person?: string }>;
}) {
  const { client, video, person } = await searchParams;
  if (person) redirect(`/content?person=${person}`);
  if (video) redirect(`/content?video=${video}`);
  if (client) redirect(`/content?client=${client}`);
  redirect("/content");
}
