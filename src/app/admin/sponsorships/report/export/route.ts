import { redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/sponsorship-auth";
import {
  loadSponsorshipReport,
  reportRange,
  reportToCsv,
} from "@/lib/admin/sponsorship-report";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAdminRequest())) redirect("/admin/sponsorships/login");
  const url = new URL(request.url);
  const range = reportRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  if (!range) {
    return new Response("Invalid date range", { status: 400 });
  }
  const items = await loadSponsorshipReport(range.from, range.to);
  return new Response(reportToCsv(items, range.from, range.to), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sponsorships-${range.from
        .toISOString()
        .slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
