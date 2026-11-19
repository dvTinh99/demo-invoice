/**
 * Mock Viettel S-Invoice 2.0 server.
 * Mô phỏng đúng các endpoint + định dạng response để chạy demo khi chưa có tài khoản Sandbox.
 * Kịch bản lỗi chọn qua header `X-Mock-Scenario`; mỗi kịch bản chỉ "nổ" 1 lần cho mỗi transactionUuid
 * để lần retry / đối soát tiếp theo đi theo luồng bình thường.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { config, VIETTEL_PATHS } from "../config";
import { buildSimplePdf } from "./pdf";
import { buildZip } from "./zip";

const TOKEN_TTL_SECONDS = 300;
/** async_number: số hóa đơn chỉ "có" sau khoảng này (Viettel thực tế: 30-90s) */
const ASYNC_NUMBER_DELAY_MS = 8_000;

const g = globalThis as unknown as { __mockFired?: Set<string> };
const fired = (g.__mockFired ??= new Set<string>());

/** true nếu kịch bản này chưa nổ cho transactionUuid — và đánh dấu đã nổ. */
function fireOnce(scenario: string | null, uuid: string, expected: string) {
  if (scenario !== expected) return false;
  const key = `${uuid}:${scenario}`;
  if (fired.has(key)) return false;
  fired.add(key);
  return true;
}

/** Lỗi nghiệp vụ theo định dạng {code, message, data} (mục 8 - Bộ mã lỗi hay gặp). */
const badRequest = (message: string, data: string) => json({ code: 400, message, data }, 400);

type Payload = {
  generalInvoiceInfo?: Record<string, unknown>;
  buyerInfo?: Record<string, unknown>;
  payments?: Record<string, unknown>[];
  itemInfo?: Record<string, unknown>[];
  summarizeInfo?: Record<string, unknown>;
  taxBreakdowns?: Record<string, unknown>[];
};

/** Kiểm tra ràng buộc giống SInvoice (mục 6, 8) — trả Response lỗi hoặc null nếu hợp lệ. */
function validatePayload(p: Payload): Response | null {
  const g = p.generalInvoiceInfo ?? {};
  const uuid = String(g.transactionUuid ?? "");
  if (uuid.length < 10 || uuid.length > 36) return badRequest("BAD_REQUEST_TRANSACTION_UUID_INVALID", "transactionUuid phải dài 10-36 ký tự");
  if (!g.templateCode) return badRequest("BAD_REQUEST", "templateCode bắt buộc");
  if (!/^[a-zA-Z0-9/]{1,25}$/.test(String(g.invoiceSeries ?? ""))) return badRequest("INVOICE_SERIAL_NOT_FOUND", "Ký hiệu hóa đơn không tồn tại");
  if (!/^[A-Z]{3}$/.test(String(g.currencyCode ?? ""))) return badRequest("BAD_REQUEST", "currencyCode bắt buộc, 3 ký tự");
  if (typeof g.paymentStatus !== "boolean") return badRequest("BAD_REQUEST", "paymentStatus bắt buộc");

  const b = p.buyerInfo ?? {};
  if (Number(b.buyerNotGetInvoice ?? 0) === 0) {
    if (!b.buyerName && !b.buyerLegalName) return badRequest("BAD_REQUEST", "Tên người mua hoặc tên đơn vị là bắt buộc");
    if (!b.buyerAddressLine) return badRequest("BAD_REQUEST", "buyerAddressLine bắt buộc khi buyerNotGetInvoice = 0");
  }
  if (b.buyerTaxCode && !b.buyerLegalName) return badRequest("BAD_REQUEST", "buyerLegalName bắt buộc khi có buyerTaxCode");

  if (!p.payments?.length || !p.payments[0].paymentMethodName) return badRequest("BAD_REQUEST", "paymentMethodName bắt buộc");
  if (!Array.isArray(p.itemInfo) || p.itemInfo.length === 0) return badRequest("BAD_REQUEST", "itemInfo bắt buộc");

  for (const it of p.itemInfo) {
    const q = Number(it.quantity), up = Number(it.unitPrice), amt = Number(it.itemTotalAmountWithoutTax);
    const pct = Number(it.taxPercentage), tax = Number(it.taxAmount ?? 0);
    if (![-2, -1, 0, 5, 8, 10].includes(pct)) return badRequest("VAT_PERCENTAGE_INVALID", "Thuế GTGT( %) không hợp lệ");
    if (tax < 0) return badRequest("VAT_TAX_AMOUNT_NEGATE", "Tiền thuế không được nhập giá trị âm");
    if (Math.abs(q * up - amt) > 5) {
      return badRequest("IVI_TOTAL_A_WITHOUT_TAX_AND_UP_QUAN_NOT_COMPARED", "Đơn giá nhân thành tiền không so khớp");
    }
    const expectedTax = pct > 0 ? (amt * pct) / 100 : 0;
    if (Math.abs(expectedTax - tax) > 1) return badRequest("VAT_AMOUNT_INVALID", "Tiền thuế không hợp lệ");
  }
  const s = p.summarizeInfo ?? {};
  if (s.totalAmountWithoutTax == null || s.discountAmount == null) {
    return badRequest("BAD_REQUEST", "summarizeInfo.totalAmountWithoutTax và discountAmount bắt buộc");
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => Response.json(body, { status });

function readToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  if (m) return m[1];
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function checkAuth(req: Request): Promise<{ token: string } | Response> {
  const token = readToken(req);
  const row = token ? await prisma.mockToken.findUnique({ where: { token } }) : null;
  if (!row || row.revoked || row.expiresAt < new Date()) {
    return json({ status: 401, error: "Unauthorized", message: "Token is invalid or expired" }, 401);
  }
  return { token: row.token };
}

async function login(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.username || !body.password) {
    return json({ status: 400, message: "username/password required" }, 400);
  }
  const token = "mock." + randomBytes(24).toString("base64url");
  await prisma.mockToken.create({
    data: { token, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000) },
  });
  return json({
    access_token: token,
    token_type: "bearer",
    refresh_token: "mock-refresh." + randomBytes(12).toString("base64url"),
    expires_in: TOKEN_TTL_SECONDS,
    scope: "openid",
    iat: Math.floor(Date.now() / 1000),
    invoice_cluster: "cluster-mock",
    type: 1,
  });
}

async function createInvoice(req: Request, auth: { token: string }, taxCode: string) {
  const scenario = req.headers.get("x-mock-scenario");
  const payload = (await req.json().catch(() => null)) as Payload | null;
  if (!payload) return badRequest("JSON_PARSE_ERROR", "Lỗi định dạng dữ liệu truyền vào");
  const invalid = validatePayload(payload);
  if (invalid) return invalid;
  const info = payload.generalInvoiceInfo as { transactionUuid: string; invoiceSeries: string; templateCode: string };
  const uuid = info.transactionUuid;

  if (fireOnce(scenario, uuid, "token_expired")) {
    await prisma.mockToken.update({ where: { token: auth.token }, data: { revoked: true } });
    return json({ status: 401, error: "Unauthorized", message: "Token is invalid or expired" }, 401);
  }
  if (fireOnce(scenario, uuid, "token_general_500")) {
    // Hành vi thực tế của Viettel khi token hết hạn (mục 8 tài liệu webservice)
    await prisma.mockToken.update({ where: { token: auth.token }, data: { revoked: true } });
    return json({ timestamp: Date.now(), status: 500, error: "Internal Server Error", message: "GENERAL", path: new URL(req.url).pathname }, 500);
  }
  if (fireOnce(scenario, uuid, "business_error")) {
    // Định dạng lỗi {code, message, data} như ví dụ trong tài liệu
    return json({ code: 400, message: "INVOICE_SERIAL_NOT_FOUND", data: `Ký hiệu hóa đơn ${info.invoiceSeries} không tồn tại` }, 400);
  }
  if (fireOnce(scenario, uuid, "timeout_lost")) {
    // Request "lạc" — không lập hóa đơn, phản hồi chậm hơn timeout của client
    await sleep(config.timeoutMs + 1500);
    return json({ status: 504, message: "Gateway Timeout" }, 504);
  }

  // Idempotent theo transactionUuid: gửi lại trả về hóa đơn đã lập
  const dup = await prisma.mockInvoice.findUnique({ where: { transactionUuid: uuid } });
  if (dup) {
    const ready = dup.numberReadyAt <= new Date();
    return json({
      errorCode: null,
      description: null,
      result: { supplierTaxCode: dup.supplierTaxCode, invoiceNo: ready ? dup.invoiceNo : "", transactionID: dup.transactionID, reservationCode: dup.reservationCode, codeOfTax: null },
    });
  }
  const isAsync = fireOnce(scenario, uuid, "async_number");

  const count = await prisma.mockInvoice.count({ where: { invoiceSeries: info.invoiceSeries } });
  const created = await prisma.mockInvoice.create({
    data: {
      transactionUuid: uuid,
      supplierTaxCode: taxCode,
      templateCode: info.templateCode,
      invoiceSeries: info.invoiceSeries,
      // Định dạng thực tế: ký hiệu + số thứ tự, vd C26MQA201
      invoiceNo: `${info.invoiceSeries}${count + 1}`,
      reservationCode: randomBytes(8).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 15).padEnd(15, "X"),
      transactionID: String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, "0"),
      payload: JSON.stringify(payload),
      numberReadyAt: new Date(Date.now() + (isAsync ? ASYNC_NUMBER_DELAY_MS : 0)),
    },
  });

  if (fireOnce(scenario, uuid, "timeout_created")) {
    // Hóa đơn ĐÃ lập nhưng response về chậm => client timeout
    await sleep(config.timeoutMs + 1500);
  }

  return json({
    errorCode: null,
    description: null,
    result: {
      supplierTaxCode: created.supplierTaxCode,
      invoiceNo: isAsync ? "" : created.invoiceNo,
      transactionID: created.transactionID,
      reservationCode: created.reservationCode,
      codeOfTax: null,
    },
  });
}

async function search(req: Request) {
  const form = new URLSearchParams(await req.text());
  const uuid = form.get("transactionUuid");
  if (!uuid) return json({ errorCode: "INVALID_REQUEST", description: "transactionUuid required", result: null }, 400);
  const inv = await prisma.mockInvoice.findUnique({ where: { transactionUuid: uuid } });
  return json({
    errorCode: null,
    description: null,
    transactionUuid: uuid,
    result: inv
      ? [{
          supplierTaxCode: inv.supplierTaxCode,
          invoiceNo: inv.numberReadyAt <= new Date() ? inv.invoiceNo : "",
          transactionID: inv.transactionID,
          reservationCode: inv.reservationCode,
          issueDate: inv.createdAt.getTime(),
          status: "Hóa đơn gốc",
          exchangeStatus: "Đã cấp mã",
        }]
      : [],
  });
}

async function getFile(req: Request) {
  const body = await req.json().catch(() => ({}));
  const inv = body.transactionUuid
    ? await prisma.mockInvoice.findUnique({ where: { transactionUuid: body.transactionUuid } })
    : await prisma.mockInvoice.findUnique({ where: { invoiceNo: body.invoiceNo ?? "" } });
  if (!inv) return json({ errorCode: "INVOICE_NOT_FOUND", description: "Không tìm thấy hóa đơn" }, 404);

  const p = JSON.parse(inv.payload);
  const pm = p.payments?.[0]?.paymentMethodName ?? "";
  const buyerLabel = p.buyerInfo.buyerLegalName || p.buyerInfo.buyerName || "Người mua không lấy hóa đơn";
  const taxLabel = (v: number) => (v === -2 ? "KCT" : v === -1 ? "KKKNT" : `${v}%`);
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  const pdf = buildSimplePdf([
    { text: "HOA DON GIA TRI GIA TANG (MOCK)", size: 16, bold: true },
    { text: `Mau so: ${inv.templateCode}   Ky hieu: ${inv.invoiceSeries}   So: ${inv.invoiceNo}` },
    { text: `Ma tra cuu: ${inv.reservationCode}   Ngay lap: ${inv.createdAt.toISOString().slice(0, 10)}` },
    { text: `Don vi ban: MST ${inv.supplierTaxCode}` },
    { text: " " },
    { text: `Don vi mua: ${buyerLabel}`, bold: true },
    ...(p.buyerInfo.buyerLegalName && p.buyerInfo.buyerName ? [{ text: `Nguoi mua hang: ${p.buyerInfo.buyerName}` }] : []),
    { text: `MST: ${p.buyerInfo.buyerTaxCode || "-"}   Dia chi: ${p.buyerInfo.buyerAddressLine ?? "-"}` },
    { text: `Hinh thuc thanh toan: ${pm}` },
    { text: " " },
    { text: "STT | Ten hang | DVT | SL | Don gia | Thanh tien | Thue", bold: true },
    ...p.itemInfo.map((it: Record<string, number | string>) => ({
      text: `${it.lineNumber} | ${it.itemName} | ${it.unitName} | ${it.quantity} | ${fmt(+it.unitPrice)} | ${fmt(+it.itemTotalAmountWithoutTax)} | ${taxLabel(+it.taxPercentage)}`,
    })),
    { text: " " },
    { text: `Cong tien hang: ${fmt(p.summarizeInfo.totalAmountWithoutTax)} VND` },
    { text: `Tien thue GTGT: ${fmt(p.summarizeInfo.totalTaxAmount)} VND` },
    { text: `Tong thanh toan: ${fmt(p.summarizeInfo.totalAmountWithTax)} VND`, bold: true, size: 12 },
    { text: `Bang chu: ${p.summarizeInfo.totalAmountWithTaxInWords}` },
    ...(p.generalInvoiceInfo.invoiceNote ? [{ text: `Ghi chu: ${p.generalInvoiceInfo.invoiceNote}` }] : []),
    { text: " " },
    { text: `transactionUuid: ${inv.transactionUuid}`, size: 8 },
    { text: "Ban the hien do Mock Viettel S-Invoice sinh ra - khong co gia tri phap ly.", size: 8 },
  ]);
  if (String(body.fileType ?? "PDF").toUpperCase() === "ZIP") {
    // ZIP thực tế gồm .xml, .xsl, logo, QR...; Mock chỉ gói XML dữ liệu + PDF
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<HDon mock="true"><TTChung><KHMSHDon>${inv.templateCode}</KHMSHDon><KHHDon>${inv.invoiceSeries}</KHHDon><SHDon>${inv.invoiceNo}</SHDon></TTChung><DLieu><![CDATA[${inv.payload}]]></DLieu></HDon>`;
    const zip = buildZip([
      { name: `${inv.invoiceNo}.xml`, data: Buffer.from(xml, "utf8") },
      { name: `${inv.invoiceNo}.pdf`, data: pdf },
    ]);
    return json({ errorCode: null, description: null, fileName: `${inv.invoiceNo}.zip`, fileToBytes: zip.toString("base64") });
  }
  return json({ errorCode: null, description: null, fileName: `${inv.invoiceNo}.pdf`, fileToBytes: pdf.toString("base64") });
}

export async function handleMockRequest(req: Request, path: string): Promise<Response> {
  if (path === VIETTEL_PATHS.login) return login(req);

  // Admin (chỉ cho demo): thu hồi toàn bộ token để giả lập token hết hạn phía server
  if (path === "/__admin/revoke-tokens") {
    const r = await prisma.mockToken.updateMany({ where: { revoked: false }, data: { revoked: true } });
    return json({ revoked: r.count });
  }

  const auth = await checkAuth(req);
  if (auth instanceof Response) return auth;

  const createPrefix = VIETTEL_PATHS.createInvoice("");
  if (path.startsWith(createPrefix)) return createInvoice(req, auth, decodeURIComponent(path.slice(createPrefix.length)));
  if (path === VIETTEL_PATHS.searchByTransactionUuid) return search(req);
  if (path === VIETTEL_PATHS.getInvoiceFile) return getFile(req);

  return json({ status: 404, message: `Mock: no handler for ${path}` }, 404);
}
