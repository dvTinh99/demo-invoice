import { prisma } from "../db";
import { config, VIETTEL_PATHS } from "../config";
import { writeLog } from "../logger";
import { ViettelAuthError } from "./errors";
import type { ViettelLoginResponse } from "./types";

/** Refresh sớm trước khi hết hạn để tránh token chết giữa chừng. */
const REFRESH_SKEW_MS = 60_000;
const TOKEN_ID = "viettel";

type Cached = { accessToken: string; expiresAt: Date };

const g = globalThis as unknown as {
  __vtToken?: Cached;
  /** single-flight: nhiều request đồng thời chỉ login 1 lần */
  __vtLoginInflight?: Promise<Cached>;
};

const isFresh = (t?: Cached | null): t is Cached =>
  !!t && t.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now();

async function login(invoiceId?: string | null, reason = "no token"): Promise<Cached> {
  const url = config.baseUrl + VIETTEL_PATHS.login;
  const body = JSON.stringify({ username: config.username, password: config.password });
  const started = Date.now();
  let status: number | undefined;
  let text: string | undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
    status = res.status;
    text = await res.text();
    if (!res.ok) throw new ViettelAuthError(`Login failed: HTTP ${res.status}`);
    const data = JSON.parse(text) as ViettelLoginResponse;
    if (!data.access_token) throw new ViettelAuthError("Login response missing access_token");
    const cached: Cached = {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000),
    };
    await prisma.tokenCache.upsert({
      where: { id: TOKEN_ID },
      create: { id: TOKEN_ID, ...cached },
      update: cached,
    });
    g.__vtToken = cached;
    await writeLog({
      kind: "AUTH", invoiceId, method: "POST", url, requestBody: body, status,
      responseBody: text, durationMs: Date.now() - started, note: `Login (${reason})`,
    });
    return cached;
  } catch (e) {
    await writeLog({
      kind: "AUTH", invoiceId, method: "POST", url, requestBody: body, status: status ?? null,
      responseBody: text ?? null, durationMs: Date.now() - started,
      error: (e as Error).message, note: `Login (${reason}) failed`,
    });
    throw e instanceof ViettelAuthError ? e : new ViettelAuthError((e as Error).message);
  }
}

/**
 * Lấy access token hợp lệ: memory → DB → login.
 * `force = true` khi vừa nhận 401 (token bị thu hồi phía server).
 */
export async function getAccessToken(opts: { force?: boolean; invoiceId?: string | null; reason?: string } = {}) {
  if (!opts.force) {
    if (isFresh(g.__vtToken)) return g.__vtToken.accessToken;
    const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
    if (isFresh(row)) {
      g.__vtToken = { accessToken: row.accessToken, expiresAt: row.expiresAt };
      return row.accessToken;
    }
  }
  if (!g.__vtLoginInflight) {
    const reason = opts.reason ?? (opts.force ? "forced refresh" : g.__vtToken ? "token expiring" : "no token");
    g.__vtLoginInflight = login(opts.invoiceId, reason).finally(() => {
      g.__vtLoginInflight = undefined;
    });
  }
  return (await g.__vtLoginInflight).accessToken;
}

export async function getTokenInfo() {
  const row = await prisma.tokenCache.findUnique({ where: { id: TOKEN_ID } });
  if (!row) return null;
  return {
    tokenPreview: row.accessToken.slice(0, 10) + "…",
    expiresAt: row.expiresAt.toISOString(),
    fresh: isFresh(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Demo: làm token local "hết hạn" để thấy cơ chế refresh chủ động. */
export async function expireLocalToken() {
  g.__vtToken = undefined;
  await prisma.tokenCache.updateMany({ where: { id: TOKEN_ID }, data: { expiresAt: new Date(0) } });
}

export async function clearToken() {
  g.__vtToken = undefined;
  await prisma.tokenCache.deleteMany({});
}
