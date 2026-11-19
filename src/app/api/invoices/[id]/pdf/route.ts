import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http-utils";
import { getInvoiceFile } from "@/lib/viettel/api";

/**
 * Mục 7.3: hóa đơn được đẩy vào CSDL ~1s sau khi phát hành (bất đồng bộ),
 * nên lấy file sau 2-5s. Nếu hóa đơn vừa phát hành thì chờ cho đủ.
 */
const MIN_AGE_MS = 3_000;

export async function GET(req: Request, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  const fileType = new URL(req.url).searchParams.get("type")?.toUpperCase() === "ZIP" ? "ZIP" : "PDF";
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv?.invoiceNo) {
    return Response.json({ error: "NOT_ISSUED", message: "Hóa đơn chưa có số" }, { status: 400 });
  }
  const age = Date.now() - (inv.issuedAt ?? inv.updatedAt).getTime();
  if (age < MIN_AGE_MS) await new Promise((r) => setTimeout(r, MIN_AGE_MS - age));

  try {
    const file = await getInvoiceFile(
      { invoiceNo: inv.invoiceNo, transactionUuid: inv.transactionUuid, fileType },
      { invoiceId: inv.id },
    );
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": fileType === "ZIP" ? "application/zip" : "application/pdf",
        "Content-Disposition": `${fileType === "ZIP" ? "attachment" : "inline"}; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
