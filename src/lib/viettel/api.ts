import { config, VIETTEL_PATHS } from "../config";
import { ViettelAmbiguousError, ViettelBusinessError } from "./errors";
import { viettelRequest } from "./http";
import type {
  ViettelCreateInvoiceResponse,
  ViettelErrorEnvelope,
  ViettelFileResponse,
  ViettelSearchItem,
  ViettelSearchResponse,
} from "./types";

/** trackingCode: chỉ SePay dùng; giữ ở đây để 2 provider cùng chữ ký. */
type Ctx = { invoiceId?: string | null; mockScenario?: string | null; trackingCode?: string | null };

/** Chuẩn hóa 2 định dạng lỗi của Viettel thành {code, message}. */
function parseError(status: number, d: (ViettelErrorEnvelope & { errorCode?: string | null; description?: string | null }) | null) {
  const code = d?.errorCode || d?.message || d?.error || `HTTP_${status}`;
  const message =
    d?.description || (typeof d?.data === "string" && d.data !== code ? d.data : null) || d?.message || `Viettel từ chối (HTTP ${status})`;
  return { code: String(code), message: String(message) };
}

export type CreateInvoiceResult = {
  supplierTaxCode: string;
  /** Rỗng khi Viettel xử lý bất đồng bộ — cần tra cứu lại sau 30-90s */
  invoiceNo: string;
  transactionID: string;
  reservationCode: string;
  codeOfTax: string | null;
};

export async function createInvoice(payload: unknown, ctx: Ctx): Promise<CreateInvoiceResult> {
  const res = await viettelRequest<ViettelCreateInvoiceResponse>({
    kind: "CREATE",
    path: VIETTEL_PATHS.createInvoice(config.supplierTaxCode),
    json: payload,
    ...ctx,
  });

  // 5xx / gateway: không chắc Viettel đã xử lý hay chưa => phải đối soát
  if (res.status >= 500 || res.status === 408 || res.status === 429) {
    throw new ViettelAmbiguousError(`HTTP ${res.status} từ Viettel`, "SERVER_ERROR");
  }
  const d = res.data;
  if (res.status >= 200 && res.status < 300 && d && !d.errorCode && d.result) {
    return {
      supplierTaxCode: String(d.result.supplierTaxCode ?? ""),
      invoiceNo: String(d.result.invoiceNo ?? ""),
      transactionID: String(d.result.transactionID ?? ""),
      reservationCode: String(d.result.reservationCode ?? ""),
      codeOfTax: d.result.codeOfTax ? String(d.result.codeOfTax) : null,
    };
  }
  if (res.status >= 200 && res.status < 300 && !d) {
    // 2xx nhưng body không đọc được => không chắc chắn
    throw new ViettelAmbiguousError("Response 2xx không phải JSON hợp lệ", "SERVER_ERROR");
  }
  const err = parseError(res.status, d);
  throw new ViettelBusinessError(err.message, err.code, res.status);
}

/** Đối soát: tra cứu hóa đơn theo transactionUuid. Trả null nếu không tồn tại. */
export async function searchByTransactionUuid(transactionUuid: string, ctx: Ctx): Promise<ViettelSearchItem | null> {
  const res = await viettelRequest<ViettelSearchResponse>({
    kind: "SEARCH",
    path: VIETTEL_PATHS.searchByTransactionUuid,
    form: { supplierTaxCode: config.supplierTaxCode, transactionUuid },
    invoiceId: ctx.invoiceId,
    mockScenario: ctx.mockScenario,
  });
  if (res.status >= 500) throw new ViettelAmbiguousError(`HTTP ${res.status} khi tra cứu`, "SERVER_ERROR");
  // Có lỗi => không được kết luận "không tồn tại" (nếu kết luận sai sẽ dẫn tới gửi lại => trùng hóa đơn)
  if (res.status !== 200 || res.data?.errorCode) {
    const err = parseError(res.status, res.data);
    throw new ViettelAmbiguousError(`Tra cứu lỗi: [${err.code}] ${err.message}`, "SERVER_ERROR");
  }
  const r = res.data?.result;
  const item = Array.isArray(r) ? r[0] : r;
  return item?.invoiceNo ? item : null;
}

export async function getInvoiceFile(
  args: { invoiceNo: string; transactionUuid: string; fileType?: "PDF" | "ZIP" },
  ctx: Ctx,
) {
  const res = await viettelRequest<ViettelFileResponse>({
    kind: "FILE",
    path: VIETTEL_PATHS.getInvoiceFile,
    json: {
      supplierTaxCode: config.supplierTaxCode,
      invoiceNo: args.invoiceNo,
      templateCode: config.templateCode,
      transactionUuid: args.transactionUuid,
      fileType: args.fileType ?? "PDF",
    },
    ...ctx,
  });
  const d = res.data;
  if (res.status !== 200 || !d || d.errorCode || !d.fileToBytes) {
    const err = parseError(res.status, d);
    throw new ViettelBusinessError(err.message, err.code, res.status);
  }
  const ext = (args.fileType ?? "PDF").toLowerCase();
  return { fileName: d.fileName || `${args.invoiceNo}.${ext}`, bytes: Buffer.from(d.fileToBytes, "base64") };
}
