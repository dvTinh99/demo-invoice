function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  get mockMode() {
    return env("VIETTEL_MOCK_MODE", "true").toLowerCase() === "true";
  },
  get appUrl() {
    return env("APP_URL", "http://localhost:3000").replace(/\/$/, "");
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
export function validateConfig(): string[] {
  const e: string[] = [];
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
