/**
 * Matbao-invoice (Mắt Bão) — API Proxy HĐĐT v1.0.1 (docs/API-Proxy-HDDT-v1.0.1.docx, tải từ matbao.in/thong-tin-api).
 * Demo: https://demo-api-hddt.matbao.in:11443 · Production: https://api-hddt.matbao.in:11443
 *
 *  - Đăng nhập POST /api/auth/login {MST, TDNhap, MKhau} => token (Data)
 *  - Tạo + phát hành POST /api/invoice/create-invoice [ {...}, LoaiHDon = 1 ]
 *  - Chống trùng: MTChieu (mã tham chiếu, tối đa 20 ký tự) suy ra cố định từ transactionUuid +
 *    KTraMTChieuTrung = 1 (trùng thì không import) => lỗi 305; MaTraCuu = transactionUuid (lỗi trùng 304)
 *  - Đối soát POST /api/invoice/invoice-detail-batch {loai: 1, mauSo, kiHieu, danhSach: [MTChieu]}
 *  - Tải file POST /api/invoice/download-invoice {MaTraCuu, MaSoHDon}
 *  - Response chung {Success, Data, ErrorCode, Message} — server demo thực tế trả camelCase
 *    {success, data, errorCode (số), message}, luôn HTTP 200 => đọc key không phân biệt hoa thường
 * Đã xác minh trên demo (19/11/2026): login trả data {accessToken, expiredDate}; token gửi qua
 * Authorization: Bearer (templates trả 200). Chưa rõ cấu trúc Data của create/detail/download
 * (đọc theo tên trường trong webhook) — đánh dấu ponytail bên dưới.
 */
import { config } from "./config";
import { prisma } from "./db";
import { writeLog } from "./logger";
import { buildCreateInvoicePayload, type InvoiceInput } from "./invoice/payload";
import type { CreateInvoiceResult } from "./viettel/api";
import { ViettelAmbiguousError, ViettelAuthError, ViettelBusinessError } from "./viettel/errors";
import type { ViettelSearchItem } from "./viettel/types";

type Ctx = { invoiceId?: string | null; trackingCode?: string | null };
type Envelope = { Success?: boolean; Data?: unknown; ErrorCode?: string | number | null; Message?: string | null };
type Inv = Record<string, unknown>;

const TOKEN_ID = "matbao";
/** Dự phòng khi login không trả expiredDate; 401/403 vẫn tự đăng nhập lại. */
const TOKEN_TTL_MS = 12 * 3600_000;
const AUTH_CODES = ["401", "402", "403"];
/** Trùng mã tham chiếu / mã tra cứu / đã phát hành => có thể lần trước đã thành công: đi đối soát. */
const DUPLICATE_CODES = ["302", "304", "305"];

const g = globalThis as unknown as { __mbToken?: { accessToken: string; expiresAt: Date }; __mbLogin?: Promise<string> };

/** Mã tham chiếu cố định cho mọi lần gửi lại: 20 ký tự hex đầu của transactionUuid (80 bit). */
export const refCode = (transactionUuid: string) => transactionUuid.replace(/-/g, "").slice(0, 20);

/** Đọc field không phân biệt hoa thường, thử lần lượt nhiều tên. */
const get = (o: unknown, ...keys: string[]): unknown => {
  if (!o || typeof o !== "object") return undefined;
  for (const key of keys) {
    const k = Object.keys(o).find((x) => x.toLowerCase() === key.toLowerCase());
    if (k && (o as Inv)[k] != null && (o as Inv)[k] !== "") return (o as Inv)[k];
  }
  return undefined;
};
const str = (v: unknown) => (v == null ? "" : String(v));
/** Chuẩn hóa envelope về PascalCase như tài liệu. */
const envelope = (raw: unknown): Envelope => ({
  Success: get(raw, "Success") as boolean | undefined,
  Data: get(raw, "Data"),
  ErrorCode: get(raw, "ErrorCode") as string | number | undefined,
  Message: get(raw, "Message") as string | undefined,
});

// ---------- token ----------

async function login(invoiceId?: string | null): Promise<string> {
  const m = config.matbao;
  const url = `${m.baseUrl}/api/auth/login`;
  const body = JSON.stringify({ MST: m.taxCode, TDNhap: m.username, MKhau: m.password });
  const started = Date.now();
  let status: number | null = null;
  let text: string | null = null;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(m.timeoutMs), cache: "no-store" });
    status = res.status;
    text = await res.text();
    const d = envelope(JSON.parse(text));
    const data = d.Data;
    const token = typeof data === "string" ? data : str(get(data, "token", "access_token", "accessToken"));
    if (!res.ok || d.Success === false || !token) throw new ViettelAuthError(`Mắt Bão login failed: HTTP ${res.status} [${str(d.ErrorCode)}] ${str(d.Message)}`);
    const exp = Date.parse(str(get(data, "expiredDate")));
    const cached = { accessToken: token, expiresAt: new Date(Number.isFinite(exp) ? exp : Date.now() + TOKEN_TTL_MS) };
    await prisma.tokenCache.upsert({ where: { id: TOKEN_ID }, create: { id: TOKEN_ID, ...cached }, update: cached });
    g.__mbToken = cached;
    // Che MKhau (logger chỉ che "password") và token trong response
    await writeLog({ kind: "AUTH", invoiceId, method: "POST", url, requestBody: body.replace(/("MKhau"\s*:\s*")[^"]*"/, '$1***"'), status, responseBody: text.replace(token, token.slice(0, 6) + "…"), durationMs: Date.now() - started, note: "Mắt Bão login" });
    return token;
  } catch (e) {
    await writeLog({ kind: "AUTH", invoiceId, method: "POST", url, requestBody: body.replace(/("MKhau"\s*:\s*")[^"]*"/, '$1***"'), status, responseBody: text, durationMs: Date.now() - started, error: (e as Error).message, note: "Mắt Bão login failed" });
    throw e instanceof ViettelAuthError ? e : new ViettelAuthError((e as Error).message);
  }
}

const fresh = (t?: { expiresAt: Date } | null) => !!t && t.expiresAt.getTime() - 60_000 > Date.now();

async function getToken(force: boolean, invoiceId?: string | null): Promise<string> {
  if (!force) {
    if (fresh(g.__mbToken)) return g.__mbToken!.accessToken;
    const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
    if (row && fresh(row)) return (g.__mbToken = row).accessToken;
  }
  g.__mbLogin ??= login(invoiceId).finally(() => (g.__mbLogin = undefined));
  return g.__mbLogin;
}

export async function getTokenInfo() {
  const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
  return row && { tokenPreview: row.accessToken.slice(0, 10) + "…", expiresAt: row.expiresAt.toISOString(), fresh: fresh(row), updatedAt: row.updatedAt.toISOString() };
}

// ---------- http ----------

async function call(kind: "CREATE" | "SEARCH" | "FILE", path: string, ctx: Ctx, json: unknown): Promise<Envelope> {
  const m = config.matbao;
  const url = m.baseUrl + path;
  const body = JSON.stringify(json);
  for (let attempt = 1; ; attempt++) {
    const token = await getToken(attempt > 1, ctx.invoiceId);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(m.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const isTimeout = ["TimeoutError", "AbortError"].includes((e as Error).name);
      await writeLog({ kind, invoiceId: ctx.invoiceId, method: "POST", url, requestBody: body, durationMs: Date.now() - started, error: (e as Error).message });
      throw new ViettelAmbiguousError(isTimeout ? `Timeout sau ${m.timeoutMs}ms` : `Lỗi mạng: ${(e as Error).message}`, isTimeout ? "TIMEOUT" : "NETWORK");
    }
    const text = await res.text();
    await writeLog({ kind, invoiceId: ctx.invoiceId, method: "POST", url, requestBody: body, status: res.status, responseBody: text, durationMs: Date.now() - started, note: attempt > 1 ? "Retry sau khi đăng nhập lại" : null });
    let d: Envelope | null = null;
    try {
      d = envelope(JSON.parse(text));
    } catch {
      /* non-JSON */
    }
    // Token bị từ chối => Mắt Bão chưa xử lý request, đăng nhập lại và gửi lại 1 lần an toàn
    const authFail = res.status === 401 || AUTH_CODES.includes(str(d?.ErrorCode));
    if (authFail && attempt === 1) continue;
    if (authFail) throw new ViettelAuthError("Mắt Bão vẫn từ chối token sau khi đăng nhập lại");
    if (res.status >= 500 || !d) throw new ViettelAmbiguousError(`HTTP ${res.status} từ Mắt Bão`, "SERVER_ERROR");
    return d;
  }
}

const isOk = (d: Envelope) => d.Success === true && (!d.ErrorCode || str(d.ErrorCode) === "200");
const errMsg = (d: Envelope) => `[${str(d.ErrorCode) || "?"}] ${str(d.Message) || "Mắt Bão từ chối"}`;

// ---------- payload ----------

/** Thuế suất nội bộ (-2 = KCT, -1 = KKKNT theo Viettel) -> TSuat Mắt Bão (-1 = KCT, -2 = KKKNT: NGƯỢC LẠI). */
const tsuat = (t: number) => (t === -2 ? -1 : t === -1 ? -2 : t);
const PAYMENT: Record<string, string> = { "1": "TM", "6": "TM", "2": "CK", "7": "CK", "3": "TM/CK", "8": "TM/CK" };
/** Ngày lập phải là ngày hiện tại (lỗi 332) — giờ Việt Nam, dạng yyyy-MM-ddTHH:mm:ss. */
const nowVN = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(" ", "T");

export function buildMatbaoPayload(input: InvoiceInput, transactionUuid: string) {
  const v = buildCreateInvoicePayload(input, transactionUuid);
  const s = v.summarizeInfo;
  const b = input.buyer;
  return {
    LoaiHDon: 1, // tạo và phát hành
    TCHDon: 0, // hóa đơn mới
    KTraMTChieuTrung: 1, // trùng mã tham chiếu thì không import
    KHMSHDon: config.matbao.pattern,
    KHHDon: config.matbao.serial,
    NLap: nowVN(),
    DVTTe: 704, // VND
    TGia: 1,
    HTTToan: PAYMENT[input.paymentMethod] ?? "TM/CK",
    MaTraCuu: transactionUuid,
    MTChieu: refCode(transactionUuid),
    GChu: input.note ?? "",
    NMua_Ten: b.legalName || b.name || "",
    NMua_HVTNMHang: b.name ?? "",
    NMua_MST: b.taxCode ?? "",
    NMua_DChi: b.address ?? "",
    NMua_SDThoai: b.phone ?? "",
    NMua_DCTDTu: b.email ?? "",
    DSHHDVu: v.itemInfo.map((l) => ({
      TChat: 1,
      STT: l.lineNumber,
      MHHDVu: l.itemCode || `SP${String(l.lineNumber).padStart(3, "0")}`,
      THHDVu: l.itemName,
      DVTinh: l.unitName,
      SLuong: l.quantity,
      DGia: l.unitPrice,
      ThTienChuaCK: l.itemTotalAmountWithoutTax,
      TLCKhau: 0,
      STCKhau: 0,
      ThTien: l.itemTotalAmountWithoutTax,
      TSuat: tsuat(l.taxPercentage),
      TThue: l.taxAmount,
      TgTien: l.itemTotalAmountWithTax,
    })),
    TgThTien: s.totalAmountWithoutTax,
    TTCKTMai: 0,
    TGTKhac: 0,
    TgTThue: s.totalTaxAmount,
    TgTTTBSo: s.totalAmountWithTax,
    TgTTTBChu: s.totalAmountWithTaxInWords,
  };
}

// ---------- API (cùng chữ ký với viettel/api.ts) ----------

/** Data có thể là object, mảng hoặc {invoices: [...]} — lấy hóa đơn đầu tiên. */
const firstInvoice = (data: unknown): Inv | undefined => {
  const list = Array.isArray(data) ? data : (get(data, "invoices") as unknown[] | undefined) ?? (data && typeof data === "object" ? [data] : []);
  return list[0] as Inv | undefined;
};

/** Đọc theo tên trường API (maSoHDon, shDon, maTraCuu — xác minh trên demo) và webhook (InvID, No, Fkey, MCCQT). */
const toResult = (inv: Inv): CreateInvoiceResult => {
  const no = str(get(inv, "SHDon", "No", "InvoiceNo"));
  return {
    supplierTaxCode: config.matbao.taxCode,
    invoiceNo: no && no !== "0" ? no : "",
    transactionID: str(get(inv, "MaSoHDon", "InvID")),
    reservationCode: str(get(inv, "MaTraCuu", "Fkey")),
    codeOfTax: str(get(inv, "MCCQT")) || null,
  };
};

export async function createInvoice(payload: ReturnType<typeof buildMatbaoPayload>, ctx: Ctx): Promise<CreateInvoiceResult> {
  const outer = await call("CREATE", "/api/invoice/create-invoice", ctx, [{ ...payload, NLap: nowVN() }]);
  // Data = mảng kết quả từng hóa đơn: [{errorCode, message, data: {shDon, maSoHDon, ...}, success}]
  // (xác minh trên demo 19/11/2026) — lỗi riêng nằm ở phần tử, kể cả khi lớp ngoài báo lỗi:
  // gửi trùng => outer {errorCode: 201}, item {errorCode: 304, message: "ExistsFkey", data: <hóa đơn đã có>}
  const item = firstInvoice(outer.Data);
  const d = item && get(item, "errorCode") !== undefined ? envelope(item) : outer;
  if (isOk(d)) {
    const inv = d === outer ? item : (d.Data as Inv | undefined);
    // Thành công nhưng không đọc được số => để đối soát lấy (AWAITING_NUMBER), không gửi lại
    return inv ? toResult(inv) : { supplierTaxCode: config.matbao.taxCode, invoiceNo: "", transactionID: "", reservationCode: payload.MaTraCuu, codeOfTax: null };
  }
  const code = str(d.ErrorCode);
  if (DUPLICATE_CODES.includes(code)) throw new ViettelAmbiguousError(errMsg(d), "SERVER_ERROR");
  if (code === "500" || !code) throw new ViettelAmbiguousError(errMsg(d), "SERVER_ERROR");
  throw new ViettelBusinessError(str(d.Message) || "Mắt Bão từ chối", `MATBAO_${code}`, 200);
}

/** Đối soát theo mã tham chiếu (MTChieu). notFound => chưa có trên Mắt Bão, an toàn gửi lại. */
export async function searchByTransactionUuid(transactionUuid: string, ctx: Ctx): Promise<ViettelSearchItem | null> {
  const ref = refCode(transactionUuid);
  const d = await call("SEARCH", "/api/invoice/invoice-detail-batch", ctx, { loai: 1, mauSo: config.matbao.pattern, kiHieu: config.matbao.serial, danhSach: [ref] });
  if (!isOk(d)) {
    if (str(d.ErrorCode) === "201" || str(d.ErrorCode) === "301") return null; // không tìm thấy
    throw new ViettelAmbiguousError(`Tra cứu lỗi ${errMsg(d)}`, "SERVER_ERROR");
  }
  const inv = firstInvoice(d.Data);
  if (!inv) return null;
  const r = toResult(inv);
  return r.invoiceNo ? { invoiceNo: r.invoiceNo, transactionID: r.transactionID, reservationCode: r.reservationCode, codeOfTax: r.codeOfTax } : null;
}

/** Tải PDF/XML theo MaSoHDon (InvID) + MaTraCuu. */
export async function getInvoiceFile(args: { invoiceNo: string; transactionUuid: string; fileType?: "PDF" | "ZIP"; trackingCode?: string | null }, ctx: Ctx) {
  if (!args.trackingCode) throw new ViettelBusinessError("Chưa có MaSoHDon của Mắt Bão để tải file", "NO_FILE", 404);
  const d = await call("FILE", "/api/invoice/download-invoice", ctx, { MaTraCuu: args.transactionUuid, MaSoHDon: args.trackingCode });
  if (!isOk(d)) throw new ViettelBusinessError(errMsg(d), `MATBAO_${str(d.ErrorCode)}`, 404);
  const want = args.fileType === "ZIP" ? "xml" : "pdf";
  // ponytail: Data chưa được mô tả — chuỗi base64 bắt đầu bằng "JVBER" là PDF, "PD94" là XML
  const data = d.Data;
  const strings = typeof data === "string" ? [data] : Object.values((data as Inv) ?? {}).filter((x): x is string => typeof x === "string");
  const b64 = strings.find((x) => x.startsWith(want === "pdf" ? "JVBER" : "PD94"));
  if (!b64) throw new ViettelBusinessError(`Mắt Bão không trả file ${want.toUpperCase()}`, "NO_FILE", 404);
  return { fileName: `${args.invoiceNo}.${want}`, bytes: Buffer.from(b64, "base64") };
}
