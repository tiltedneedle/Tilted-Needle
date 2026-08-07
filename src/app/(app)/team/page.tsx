import { redirect } from "next/navigation";

/**
 * PRD v0.5 §3: People is retired as a page. Its performance half merged
 * into /content (person= is a first-class filter there); its employment
 * half became /team-admin. This shim keeps every saved link, bookmark, and
 * old cross-reference landing somewhere that still answers the question.
 */
export default async function TeamRedirect({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; tab?: string }>;
}) {
  const { person, tab } = await searchParams;
  if (person) redirect(`/content?person=${person}`);
  if (tab === "admin") redirect("/team-admin");
  redirect("/content");
}
