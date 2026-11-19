import { prisma } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { logs: { orderBy: { createdAt: "asc" } } },
  });
  if (!invoice) return Response.json({ error: "NOT_FOUND", message: "Không tìm thấy hóa đơn" }, { status: 404 });
  return Response.json({ invoice });
}
