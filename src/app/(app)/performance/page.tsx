import { redirect } from "next/navigation";

/**
 * Performance is no longer its own page. It split in two: content analytics
 * live on /content, people analytics on /team. Anything landing here without
 * a person is asking about content.
 */
export default async function PerformanceRedirect({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; video?: string; person?: string }>;
}) {
  const { client, video, person } = await searchParams;
  if (person) redirect(`/team?person=${person}`);
  if (video) redirect(`/content?video=${video}`);
  if (client) redirect(`/content?client=${client}`);
  redirect("/content");
}
