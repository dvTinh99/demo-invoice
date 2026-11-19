import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const kind = url.searchParams.get("kind") || undefined;
  const logs = await prisma.apiLog.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { invoice: { select: { orderRef: true } } },
  });
  return Response.json({ logs });
}
