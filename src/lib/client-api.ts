"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.message ?? `HTTP ${res.status}`, res.status, body);
  return body as T;
}

export const fmtVnd = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
export const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("vi-VN", { hour12: false }) : "—";

export interface StatusInfo {
  provider: "viettel" | "sepay";
  providers: Record<"viettel" | "sepay", string>;
  mockMode: boolean;
  baseUrl: string;
  supplierTaxCode: string;
  templateCode: string;
  invoiceSeries: string;
  invoiceType: string;
  timeoutMs: number;
  minResendGapMs: number;
  configErrors: string[];
  token: { tokenPreview: string; expiresAt: string; fresh: boolean; updatedAt: string } | null;
  counts: Record<string, number>;
  scenarios: Record<string, string>;
}

export interface InvoiceRow {
  id: string;
  orderRef: string;
  provider: string;
  status: string;
  buyerName: string;
  totalAmount: number;
  invoiceNo: string | null;
  transactionUuid: string;
  idempotencyKey: string;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  mockScenario: string | null;
  createdAt: string;
  issuedAt: string | null;
}

export interface ApiLogRow {
  id: string;
  invoiceId: string | null;
  kind: string;
  method: string | null;
  url: string | null;
  requestBody: string | null;
  status: number | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
  note: string | null;
  createdAt: string;
  invoice?: { orderRef: string } | null;
}
