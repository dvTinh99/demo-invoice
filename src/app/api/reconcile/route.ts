import { errorResponse } from "@/lib/http-utils";
import { reconcileAll } from "@/lib/invoice/service";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

/** Job đối soát — có thể gọi từ cron (vd. mỗi 5 phút). */
export async function POST() {
  try {
    return Response.json({ results: await reconcileAll() });
  } catch (e) {
    return errorResponse(e);
  }
}
