import { redirect } from "next/navigation";

/** A person's work now lives on /content, as a first-class filter. */
export default async function PersonDetailRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/content?person=${userId}`);
}
