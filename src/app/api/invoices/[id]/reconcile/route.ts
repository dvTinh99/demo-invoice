import { errorResponse } from "@/lib/http-utils";
import { reconcile } from "@/lib/invoice/service";

export async function POST(_req: Request, ctx: RouteContext<"/api/invoices/[id]/reconcile">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ invoice: await reconcile(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
