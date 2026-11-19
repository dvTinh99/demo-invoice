import { cookies } from "next/headers";

export const PROVIDERS = { viettel: "Viettel S-Invoice", sepay: "SePay eInvoice" } as const;
export type Provider = keyof typeof PROVIDERS;
export const PROVIDER_COOKIE = "invoice_provider";

/** Nhà cung cấp người dùng đang chọn trên navbar (cookie). Mặc định viettel. */
export async function currentProvider(): Promise<Provider> {
  const v = (await cookies()).get(PROVIDER_COOKIE)?.value;
  return v === "sepay" ? "sepay" : "viettel";
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  /** Mock chỉ áp dụng cho Viettel; SePay luôn gọi API thật (sandbox hoặc production). */
  get mockMode() {
    return env("VIETTEL_MOCK_MODE", "true").toLowerCase() === "true";
  },
  get sepay() {
    return {
      baseUrl: env("SEPAY_BASE_URL", "https://einvoice-api-sandbox.sepay.vn").replace(/\/$/, ""),
      clientId: env("SEPAY_CLIENT_ID", ""),
      clientSecret: env("SEPAY_CLIENT_SECRET", ""),
      /** Bỏ trống => tự lấy provider account active đầu tiên từ /v1/provider-accounts */
      providerAccountId: env("SEPAY_PROVIDER_ACCOUNT_ID", ""),
      /** 1 = Hóa đơn GTGT, 2 = Hóa đơn bán hàng */
      templateCode: env("SEPAY_TEMPLATE_CODE", "1"),
      /** Lấy từ chi tiết provider account; phần C{YY} phải là năm hiện tại */
      invoiceSeries: env("SEPAY_INVOICE_SERIES", ""),
      timeoutMs: Number(env("SEPAY_TIMEOUT_MS", "30000")),
    };
  },
  /**
   * URL của chính app. Trên Vercel nếu không đặt APP_URL: bản production dùng domain production
   * (không bị Deployment Protection chặn), bản preview dùng URL của chính deployment đó.
   */
  get appUrl() {
    const vercelHost =
      process.env.VERCEL_ENV === "production"
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
        : process.env.VERCEL_URL;
    const fallback = vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
    return (process.env.APP_URL || fallback).replace(/\/$/, "");
  },
  /**
   * Header bổ sung khi app tự gọi Mock server của chính nó. Trên Vercel, bản preview có
   * Deployment Protection: bật "Protection Bypass for Automation" để Vercel cấp
   * VERCEL_AUTOMATION_BYPASS_SECRET, request nội bộ mới đi qua được.
   */
  get mockHeaders(): Record<string, string> {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    return this.mockMode && bypass ? { "x-vercel-protection-bypass": bypass } : {};
  },
  /** Base URL thực sự được gọi: Mock server nội bộ hoặc Viettel thật. */
  get baseUrl() {
    return this.mockMode
      ? `${this.appUrl}/api/mock-viettel`
      : env("VIETTEL_BASE_URL", "https://api-vinvoice.viettel.vn").replace(/\/$/, "");
  },
  get username() {
    return env("VIETTEL_USERNAME", "");
  },
  get password() {
    return env("VIETTEL_PASSWORD", "");
  },
  get supplierTaxCode() {
    return env("VIETTEL_SUPPLIER_TAX_CODE", "0100109106");
  },
  get templateCode() {
    return env("VIETTEL_TEMPLATE_CODE", "1/770");
  },
  get invoiceSeries() {
    return env("VIETTEL_INVOICE_SERIES", "K23TXM");
  },
  /** Thông tin người bán in trên bản thể hiện của Mock (Viettel thật lấy từ hồ sơ doanh nghiệp đã đăng ký). */
  get mockSeller() {
    return {
      name: env("VIETTEL_MOCK_SELLER_NAME", "Công ty TNHH Demo Hóa Đơn Điện Tử"),
      address: env("VIETTEL_MOCK_SELLER_ADDRESS", "Số 1 Trần Hữu Dực, Phường Mỹ Đình 2, Quận Nam Từ Liêm, Hà Nội"),
      phone: env("VIETTEL_MOCK_SELLER_PHONE", "024 0000 0000"),
      bankAccount: env("VIETTEL_MOCK_SELLER_BANK", "0000000000 - Ngân hàng Demo"),
    };
  },
  get invoiceType() {
    return env("VIETTEL_INVOICE_TYPE", "1");
  },
  /**
   * Timeout mỗi request. Tài liệu Viettel khuyến nghị 60-90s và phải chờ tối thiểu 90s
   * trước khi gửi lại cùng transactionUuid. Mock Mode dùng timeout ngắn để demo nhanh.
   */
  get timeoutMs() {
    return this.mockMode
      ? Number(env("VIETTEL_MOCK_TIMEOUT_MS", "5000"))
      : Math.max(60_000, Number(env("VIETTEL_TIMEOUT_MS", "90000")));
  },
  /**
   * Khoảng chờ tối thiểu kể từ lần gửi createInvoice trước khi được gửi lại cùng transactionUuid
   * (mục 5.3 "Cơ chế kiểm trùng giao dịch": tối thiểu 90 giây).
   */
  get minResendGapMs() {
    return this.mockMode ? this.timeoutMs : Math.max(90_000, this.timeoutMs);
  },
};

/** Đường dẫn API Viettel S-Invoice 2.0 (giống hệt cho Mock server). */
/** Kiểm tra cấu hình theo ràng buộc trong tài liệu (mục 6 + 7.2). Trả về danh sách lỗi. */
export function validateConfig(provider: Provider): string[] {
  const e: string[] = [];
  if (provider === "sepay") {
    const s = config.sepay;
    if (!s.clientId || !s.clientSecret) e.push("Thiếu SEPAY_CLIENT_ID / SEPAY_CLIENT_SECRET");
    if (!["1", "2"].includes(s.templateCode)) e.push("SEPAY_TEMPLATE_CODE phải là 1 (GTGT) hoặc 2 (bán hàng)");
    if (!s.invoiceSeries) e.push("Thiếu SEPAY_INVOICE_SERIES (vd C26TSE, lấy từ chi tiết provider account)");
    return e;
  }
  if (!/^[0-9-]{10,20}$/.test(config.supplierTaxCode)) e.push("VIETTEL_SUPPLIER_TAX_CODE phải dạng [0-9-], tối đa 20 ký tự");
  if (!config.templateCode || config.templateCode.length > 20) e.push("VIETTEL_TEMPLATE_CODE bắt buộc, tối đa 20 ký tự (vd 1/001)");
  if (!/^[a-zA-Z0-9/]{1,25}$/.test(config.invoiceSeries)) e.push("VIETTEL_INVOICE_SERIES chỉ gồm [a-zA-Z0-9/], tối đa 25 ký tự (vd C24TAA)");
  if (!["1", "2", "3", "4", "5", "6"].includes(config.invoiceType)) e.push("VIETTEL_INVOICE_TYPE theo TT78 phải là 1-6");
  if (!config.mockMode && (!config.username || !config.password)) e.push("Thiếu VIETTEL_USERNAME / VIETTEL_PASSWORD");
  return e;
}

export const VIETTEL_PATHS = {
  login: "/auth/login",
  createInvoice: (taxCode: string) =>
    `/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS/createInvoice/${encodeURIComponent(taxCode)}`,
  searchByTransactionUuid:
    "/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS/searchInvoiceByTransactionUuid",
  getInvoiceFile: "/services/einvoiceapplication/api/InvoiceAPI/InvoiceUtilsWS/getInvoiceRepresentationFile",
};

export const MOCK_SCENARIOS = {
  success: "Thành công",
  token_expired: "Token hết hạn phía server → 401 → tự refresh & retry",
  token_general_500: "Token hết hạn kiểu Viettel: HTTP 500 \"GENERAL\" → tự refresh & retry",
  async_number: "Viettel nhận hóa đơn nhưng trả invoiceNo rỗng (xử lý bất đồng bộ) → đối soát lấy số",
  timeout_created: "Timeout, nhưng Viettel ĐÃ lập hóa đơn → đối soát tìm thấy",
  timeout_lost: "Timeout, Viettel CHƯA lập hóa đơn → đối soát không thấy → gửi lại an toàn",
  business_error: "Lỗi nghiệp vụ từ Viettel (lần đầu) → FAILED",
} as const;

export type MockScenario = keyof typeof MOCK_SCENARIOS;
