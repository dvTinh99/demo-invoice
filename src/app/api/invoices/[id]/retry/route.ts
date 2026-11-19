import { errorResponse } from "@/lib/http-utils";
import { retry } from "@/lib/invoice/service";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/invoices/[id]/retry">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ invoice: await retry(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
