import { errorResponse } from "@/lib/http-utils";
import { reconcile } from "@/lib/invoice/service";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/invoices/[id]/reconcile">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ invoice: await reconcile(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
