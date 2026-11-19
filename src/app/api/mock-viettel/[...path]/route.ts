import { config } from "@/lib/config";
import { handleMockRequest } from "@/lib/mock/server";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/mock-viettel/[...path]">) {
  if (!config.mockMode) return Response.json({ message: "Mock mode is disabled" }, { status: 404 });
  const { path } = await ctx.params;
  return handleMockRequest(req, "/" + path.map(encodeURIComponent).join("/"));
}
