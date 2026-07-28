import { redirect } from "next/navigation";

/**
 * Client detail now lives on the consolidated dashboard (PRD §1.1.2) -- one
 * canonical place, reached here by redirect so existing links (the clients
 * list) keep working without duplicating the view logic.
 */
export default async function ClientDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/performance?client=${id}`);
}
