import { redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/sponsorship-auth";

/**
 * Single guard for every protected admin page. The login page lives outside this
 * call; a future admin page cannot accidentally skip the check.
 */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdminRequest())) redirect("/admin/sponsorships/login");
}
