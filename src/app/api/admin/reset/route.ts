import { prisma } from "@/lib/db";
import { clearToken } from "@/lib/viettel/token";

/** Xóa toàn bộ dữ liệu demo (KHÔNG xóa hóa đơn trên Viettel thật). */
export async function POST() {
  await prisma.$transaction([
    prisma.apiLog.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.mockInvoice.deleteMany(),
    prisma.mockToken.deleteMany(),
  ]);
  await clearToken();
  return Response.json({ ok: true });
}
