import { redirect } from "next/navigation";

/** Client detail now lives on the Content dashboard. */
export default async function ClientDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/content?client=${id}`);
}
