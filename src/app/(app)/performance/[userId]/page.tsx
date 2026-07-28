import { redirect } from "next/navigation";

/**
 * Person detail now lives on the consolidated dashboard (PRD §1.1.4).
 */
export default async function PersonDetailRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/performance?person=${userId}`);
}
