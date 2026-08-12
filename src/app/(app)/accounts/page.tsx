import { redirect } from "next/navigation";

/**
 * Accounts moved into Data sync.
 *
 * The two pages listed the same rows and split the controls between them --
 * the sync toggle here, the archive control there -- so "why is this account
 * quiet?" was a question neither screen could answer on its own. Everything
 * an account has now lives beside its sync status.
 *
 * A redirect rather than a deletion, because links and bookmarks to this
 * route exist and a 404 would read as the feature being gone.
 */
export default function AccountsPage() {
  redirect("/data");
}
