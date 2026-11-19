import { errorResponse } from "@/lib/http-utils";
import { reconcileAll } from "@/lib/invoice/service";

/** Job đối soát — có thể gọi từ cron (vd. mỗi 5 phút). */
export async function POST() {
  try {
    return Response.json({ results: await reconcileAll() });
  } catch (e) {
    return errorResponse(e);
  }
}
