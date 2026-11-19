import { config } from "@/lib/config";
import { handleMockRequest } from "@/lib/mock/server";

export async function POST(req: Request, ctx: RouteContext<"/api/mock-viettel/[...path]">) {
  if (!config.mockMode) return Response.json({ message: "Mock mode is disabled" }, { status: 404 });
  const { path } = await ctx.params;
  return handleMockRequest(req, "/" + path.map(encodeURIComponent).join("/"));
}
