import { config } from "../config";
import { writeLog } from "../logger";
import { ViettelAmbiguousError, ViettelAuthError } from "./errors";
import { getAccessToken } from "./token";

export interface ViettelRequest {
  kind: "CREATE" | "SEARCH" | "FILE";
  path: string;
  json?: unknown;
  form?: Record<string, string>;
  invoiceId?: string | null;
  /** Chỉ dùng ở Mock Mode: chỉ định kịch bản giả lập. */
  mockScenario?: string | null;
}

export interface ViettelResponse<T> {
  status: number;
  data: T | null;
  text: string;
}

async function send<T>(req: ViettelRequest, token: string, attempt: number): Promise<ViettelResponse<T>> {
  const url = config.baseUrl + req.path;
  const headers: Record<string, string> = {
    // S-Invoice 2.0 xác thực bằng cookie access_token
    Cookie: `access_token=${token}`,
  };
  let body: string;
  if (req.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.json ?? {});
  }
  if (config.mockMode && req.mockScenario) headers["X-Mock-Scenario"] = req.mockScenario;

  const started = Date.now();
  const note = attempt > 1 ? "Retry sau khi refresh token" : null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      /* non-JSON body */
    }
    await writeLog({
      kind: req.kind, invoiceId: req.invoiceId, method: "POST", url, requestBody: body,
      status: res.status, responseBody: text, durationMs: Date.now() - started, note,
    });
    return { status: res.status, data, text };
  } catch (e) {
    const err = e as Error;
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    await writeLog({
      kind: req.kind, invoiceId: req.invoiceId, method: "POST", url, requestBody: body,
      durationMs: Date.now() - started, note,
      error: isTimeout ? `TIMEOUT sau ${config.timeoutMs}ms` : `NETWORK: ${err.message}`,
    });
    throw new ViettelAmbiguousError(
      isTimeout ? `Timeout sau ${config.timeoutMs}ms` : `Lỗi mạng: ${err.message}`,
      isTimeout ? "TIMEOUT" : "NETWORK",
    );
  }
}

/**
 * Viettel báo token hết hạn theo 2 cách: HTTP 401, hoặc HTTP 500 với message "GENERAL"
 * (mục 8 - Bộ mã lỗi hay gặp, tài liệu webservice v2.50).
 */
function isAuthFailure(status: number, text: string) {
  if (status === 401) return true;
  if (status !== 500) return false;
  try {
    return (JSON.parse(text) as { message?: string }).message === "GENERAL";
  } catch {
    return false;
  }
}

/**
 * Gửi request có xác thực. Interceptor:
 *  - tự lấy/refresh token (single-flight)
 *  - nhận 401 / 500 "GENERAL" => buộc login lại và retry đúng 1 lần
 *
 * An toàn cho createInvoice: khi token bị từ chối, Viettel chưa xử lý request nên retry
 * cùng transactionUuid không thể tạo hóa đơn thứ 2.
 */
export async function viettelRequest<T>(req: ViettelRequest): Promise<ViettelResponse<T>> {
  const token = await getAccessToken({ invoiceId: req.invoiceId });
  const first = await send<T>(req, token, 1);
  if (!isAuthFailure(first.status, first.text)) return first;

  const reason = first.status === 401 ? "received 401" : 'received 500 "GENERAL"';
  const fresh = await getAccessToken({ force: true, invoiceId: req.invoiceId, reason });
  const second = await send<T>(req, fresh, 2);
  if (isAuthFailure(second.status, second.text)) {
    throw new ViettelAuthError(`Vẫn bị từ chối xác thực sau khi refresh token (HTTP ${second.status})`);
  }
  return second;
}
