import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http-utils";
import { getInvoiceFile as matbaoFile } from "@/lib/matbao";
import { getInvoiceFile as sepayFile } from "@/lib/sepay";
import { getInvoiceFile as viettelFile } from "@/lib/viettel/api";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

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
    const getInvoiceFile = inv.provider === "sepay" ? sepayFile : inv.provider === "matbao" ? matbaoFile : viettelFile;
    const file = await getInvoiceFile(
      { invoiceNo: inv.invoiceNo, transactionUuid: inv.transactionUuid, fileType, trackingCode: inv.viettelTxnId },
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
