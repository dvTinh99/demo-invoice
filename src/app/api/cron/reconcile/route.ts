import { errorResponse } from "@/lib/http-utils";
import { reconcileAll } from "@/lib/invoice/service";

export const maxDuration = 300;

/**
 * Job đối soát cho Vercel Cron (xem vercel.json). Vercel gọi GET kèm
 * "Authorization: Bearer $CRON_SECRET"; route này không đi qua Basic Auth của proxy.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    return Response.json({ results: await reconcileAll() });
  } catch (e) {
    return errorResponse(e);
  }
}
