import { errorResponse } from "@/lib/http-utils";
import { retry } from "@/lib/invoice/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/invoices/[id]/retry">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ invoice: await retry(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
