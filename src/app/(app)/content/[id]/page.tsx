import { redirect } from "next/navigation";

/** Video detail now lives on the Content dashboard, as a filter on it. */
export default async function ContentDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/content?video=${id}`);
}
