/**
 * SePay eInvoice API v1 (https://developer.sepay.vn/vi/einvoice-api/v1/tong-quan).
 * Cùng "hợp đồng" với src/lib/viettel/api.ts để service.ts dùng chung luồng chống trùng + đối soát:
 *  - reference_code = transactionUuid (SePay bảo đảm duy nhất: gửi trùng => 409 EINVOICE_DOCUMENT_EXISTED)
 *  - tạo hóa đơn là BẤT ĐỒNG BỘ: trả tracking_code, invoiceNo rỗng => AWAITING_NUMBER, đối soát qua /create/check
 * Dùng lại các lớp lỗi Viettel vì ngữ nghĩa giống hệt (Ambiguous = chưa biết đã lập hay chưa).
 */
import { config } from "./config";
import { prisma } from "./db";
import { writeLog } from "./logger";
import type { InvoiceInput } from "./invoice/payload";
import type { CreateInvoiceResult } from "./viettel/api";
import { ViettelAmbiguousError, ViettelAuthError, ViettelBusinessError } from "./viettel/errors";
import type { ViettelSearchItem } from "./viettel/types";

type Ctx = { invoiceId?: string | null; trackingCode?: string | null };
type Envelope<T> = { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: Record<string, string> } };
type SepayInvoice = { reference_code?: string; invoice_number?: string; pdf_url?: string | null; status?: string };

const TOKEN_ID = "sepay";
/** Lỗi trạng thái tài khoản trả HTTP 500 nhưng chắc chắn chưa lập hóa đơn (trang "Xử lý lỗi"). */
const ACCOUNT_STATE_CODES = ["QUOTA_HAS_BEEN_USERD_UP", "REGISTRATION_NOT_COMPLETE", "BILLING_IS_UNPAID"];

const g = globalThis as unknown as { __spToken?: { accessToken: string; expiresAt: Date }; __spLogin?: Promise<string>; __spAccount?: string };

// ---------- token ----------

async function login(invoiceId?: string | null): Promise<string> {
  const { baseUrl, clientId, clientSecret } = config.sepay;
  const url = `${baseUrl}/v1/token`;
  const started = Date.now();
  let status: number | null = null;
  let text: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(config.sepay.timeoutMs),
      cache: "no-store",
    });
    status = res.status;
    text = await res.text();
    const d = JSON.parse(text) as Envelope<{ access_token: string; expires_in: number }>;
    if (!res.ok || !d.data?.access_token) throw new ViettelAuthError(`SePay token failed: HTTP ${res.status} ${d.error?.code ?? ""}`);
    const cached = { accessToken: d.data.access_token, expiresAt: new Date(Date.now() + (d.data.expires_in || 3600) * 1000) };
    await prisma.tokenCache.upsert({ where: { id: TOKEN_ID }, create: { id: TOKEN_ID, ...cached }, update: cached });
    g.__spToken = cached;
    await writeLog({ kind: "AUTH", invoiceId, method: "POST", url, status, responseBody: text, durationMs: Date.now() - started, note: "SePay token" });
    return cached.accessToken;
  } catch (e) {
    await writeLog({ kind: "AUTH", invoiceId, method: "POST", url, status, responseBody: text, durationMs: Date.now() - started, error: (e as Error).message, note: "SePay token failed" });
    throw e instanceof ViettelAuthError ? e : new ViettelAuthError((e as Error).message);
  }
}

const fresh = (t?: { expiresAt: Date } | null) => !!t && t.expiresAt.getTime() - 60_000 > Date.now();

async function getToken(force: boolean, invoiceId?: string | null): Promise<string> {
  if (!force) {
    if (fresh(g.__spToken)) return g.__spToken!.accessToken;
    const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
    if (row && fresh(row)) return (g.__spToken = row).accessToken;
  }
  g.__spLogin ??= login(invoiceId).finally(() => (g.__spLogin = undefined));
  return g.__spLogin;
}

export async function getTokenInfo() {
  const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
  return row && { tokenPreview: row.accessToken.slice(0, 10) + "…", expiresAt: row.expiresAt.toISOString(), fresh: fresh(row), updatedAt: row.updatedAt.toISOString() };
}

// ---------- http ----------

async function call<T>(kind: "CREATE" | "SEARCH" | "FILE", method: "GET" | "POST", path: string, ctx: Ctx, json?: unknown) {
  const url = config.sepay.baseUrl + path;
  const body = json === undefined ? undefined : JSON.stringify(json);
  for (let attempt = 1; ; attempt++) {
    const token = await getToken(attempt > 1, ctx.invoiceId);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body,
        signal: AbortSignal.timeout(config.sepay.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const isTimeout = ["TimeoutError", "AbortError"].includes((e as Error).name);
      await writeLog({ kind, invoiceId: ctx.invoiceId, method, url, requestBody: body, durationMs: Date.now() - started, error: (e as Error).message });
      throw new ViettelAmbiguousError(isTimeout ? `Timeout sau ${config.sepay.timeoutMs}ms` : `Lỗi mạng: ${(e as Error).message}`, isTimeout ? "TIMEOUT" : "NETWORK");
    }
    const text = await res.text();
    await writeLog({ kind, invoiceId: ctx.invoiceId, method, url, requestBody: body, status: res.status, responseBody: text, durationMs: Date.now() - started, note: attempt > 1 ? "Retry sau khi refresh token" : null });
    // 401 = token bị từ chối => SePay chưa xử lý request, retry 1 lần an toàn
    if (res.status === 401 && attempt === 1) continue;
    if (res.status === 401) throw new ViettelAuthError("SePay vẫn từ chối token sau khi refresh");
    let data: Envelope<T> | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: res.status, data };
  }
}

const errOf = (status: number, d: Envelope<unknown> | null) => ({
  code: d?.error?.code || `HTTP_${status}`,
  message: [d?.error?.message || `SePay từ chối (HTTP ${status})`, ...Object.entries(d?.error?.details ?? {}).map(([k, v]) => `${k}: ${v}`)].join(" · "),
});

// ---------- payload ----------

/** Mã thanh toán nội bộ (theo Viettel 1-9) -> TM | CK | TM/CK | KHAC của SePay. */
const PAYMENT: Record<string, string> = { "1": "TM", "6": "TM", "2": "CK", "7": "CK", "3": "TM/CK", "8": "TM/CK" };

/** issued_date chỉ nhận ngày hiện tại, giờ Việt Nam, dạng "YYYY-MM-DD HH:mm:ss". */
const nowVN = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });

export function buildSepayPayload(input: InvoiceInput, referenceCode: string) {
  const b = input.buyer;
  const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
  return {
    template_code: config.sepay.templateCode,
    invoice_series: config.sepay.invoiceSeries,
    issued_date: nowVN(),
    currency: "VND",
    provider_account_id: "", // điền lúc gửi (có thể tự lấy từ /v1/provider-accounts)
    reference_code: referenceCode,
    payment_method: PAYMENT[input.paymentMethod] ?? "KHAC",
    is_draft: false,
    // ponytail: tài liệu chỉ ví dụ "personal"; "company" là suy đoán cho người mua có MST — xác nhận với SePay
    buyer: compact({ type: b.taxCode ? "company" : "personal", name: b.name || b.legalName, legal_name: b.legalName, tax_code: b.taxCode, address: b.address, email: b.email, phone: b.phone }),
    items: input.items.map((it, i) =>
      // item_code bắt buộc khi line_type = 1 (lỗi VALIDATION_ERROR thực tế từ sandbox)
      compact({ line_number: i + 1, line_type: 1, item_code: it.code || `SP${String(i + 1).padStart(3, "0")}`, item_name: it.name, unit: it.unit, quantity: it.quantity, unit_price: it.unitPrice, tax_rate: it.taxPercentage }),
    ),
    notes: input.note,
  };
}

async function providerAccountId(ctx: Ctx): Promise<string> {
  if (config.sepay.providerAccountId) return config.sepay.providerAccountId;
  if (g.__spAccount) return g.__spAccount;
  const res = await call<{ items: { id: string; active: boolean }[] }>("SEARCH", "GET", "/v1/provider-accounts?page=1&per_page=20", ctx);
  const acc = res.data?.data?.items?.find((a) => a.active);
  if (!acc) throw new ViettelBusinessError("Không có provider account active trên SePay (đặt SEPAY_PROVIDER_ACCOUNT_ID)", "NO_PROVIDER_ACCOUNT", res.status);
  return (g.__spAccount = acc.id);
}

// ---------- API (cùng chữ ký với viettel/api.ts) ----------

export async function createInvoice(payload: ReturnType<typeof buildSepayPayload>, ctx: Ctx): Promise<CreateInvoiceResult> {
  // Lấy lại ngày tại thời điểm gửi: gửi lại qua ngày hôm sau thì ngày cũ bị SePay từ chối
  const body = { ...payload, issued_date: nowVN(), provider_account_id: await providerAccountId(ctx) };
  const res = await call<{ tracking_code: string }>("CREATE", "POST", "/v1/invoices/create", ctx, body);
  const d = res.data;
  if (res.status >= 200 && res.status < 300 && d?.success && d.data?.tracking_code) {
    // Mới là "đã nhận yêu cầu" — số hóa đơn có sau khi /create/check trả Success
    return { supplierTaxCode: "", invoiceNo: "", transactionID: d.data.tracking_code, reservationCode: "", codeOfTax: null };
  }
  const err = errOf(res.status, d);
  // reference_code đã có => có thể lần gửi trước đã thành công: KHÔNG kết luận lỗi, đi đối soát
  if (err.code === "EINVOICE_DOCUMENT_EXISTED") throw new ViettelAmbiguousError(`${err.code}: ${err.message}`, "SERVER_ERROR");
  if (res.status >= 500 && !ACCOUNT_STATE_CODES.includes(err.code)) throw new ViettelAmbiguousError(`HTTP ${res.status} từ SePay`, "SERVER_ERROR");
  if (res.status >= 200 && res.status < 300) throw new ViettelAmbiguousError("Response 2xx không hợp lệ", "SERVER_ERROR");
  throw new ViettelBusinessError(err.message, err.code, res.status);
}

const toItem = (inv: SepayInvoice, trackingCode?: string | null): ViettelSearchItem | null =>
  inv.invoice_number ? { invoiceNo: inv.invoice_number, transactionID: trackingCode ?? undefined, status: inv.status, pdfUrl: inv.pdf_url } : null;

/**
 * Đối soát. Có tracking_code => xem trạng thái xử lý (Pending => null, Failed => lỗi chắc chắn).
 * Không có (timeout lúc tạo) => tra theo reference_code; 404 = SePay chưa có hóa đơn.
 */
export async function searchByTransactionUuid(referenceCode: string, ctx: Ctx): Promise<ViettelSearchItem | null> {
  if (ctx.trackingCode) {
    const res = await call<{ status: string; message?: string; invoice?: SepayInvoice }>("SEARCH", "GET", `/v1/invoices/create/check/${encodeURIComponent(ctx.trackingCode)}`, ctx);
    const d = res.data?.data;
    if (res.status !== 200 || !d) throw new ViettelAmbiguousError(`Tra cứu lỗi HTTP ${res.status}`, "SERVER_ERROR");
    if (d.status === "Failed") throw new ViettelBusinessError(d.message || "SePay xử lý thất bại", "SEPAY_FAILED", 200);
    return d.status === "Success" && d.invoice ? toItem(d.invoice, ctx.trackingCode) : null;
  }
  const res = await call<SepayInvoice>("SEARCH", "GET", `/v1/invoices/${encodeURIComponent(referenceCode)}`, ctx);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data?.data) throw new ViettelAmbiguousError(`Tra cứu lỗi HTTP ${res.status}`, "SERVER_ERROR");
  return toItem(res.data.data);
}

/** Tải PDF: có tracking_code => /download (base64); không có => tải pdf_url từ chi tiết hóa đơn. */
export async function getInvoiceFile(args: { invoiceNo: string; transactionUuid: string; fileType?: "PDF" | "ZIP"; trackingCode?: string | null }, ctx: Ctx) {
  const type = args.fileType === "ZIP" ? "xml" : "pdf";
  if (args.trackingCode) {
    const res = await call<{ file_name: string; content: string }>("FILE", "GET", `/v1/invoices/${encodeURIComponent(args.trackingCode)}/download?type=${type}`, ctx);
    const d = res.data?.data;
    if (res.status !== 200 || !d?.content) throw new ViettelBusinessError(errOf(res.status, res.data).message, errOf(res.status, res.data).code, res.status);
    return { fileName: d.file_name || `${args.invoiceNo}.${type}`, bytes: Buffer.from(d.content, "base64") };
  }
  const found = await searchByTransactionUuid(args.transactionUuid, ctx);
  const pdfUrl = found?.pdfUrl as string | undefined;
  if (!pdfUrl || type !== "pdf") throw new ViettelBusinessError("SePay không trả link file cho hóa đơn này", "NO_FILE", 404);
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(config.sepay.timeoutMs) });
  if (!res.ok) throw new ViettelBusinessError(`Tải pdf_url lỗi HTTP ${res.status}`, "NO_FILE", res.status);
  return { fileName: `${args.invoiceNo}.pdf`, bytes: Buffer.from(await res.arrayBuffer()) };
}
