import { redirect } from "next/navigation";

/** Person detail now lives on the People dashboard. */
export default async function PersonDetailRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/team?person=${userId}`);
}
