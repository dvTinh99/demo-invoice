import { prisma } from "./db";

const MAX = 20_000;

function clip(s: string | undefined | null): string | null {
  if (s == null) return null;
  return s.length > MAX ? s.slice(0, MAX) + `…(+${s.length - MAX} chars)` : s;
}

/** Ẩn password / token trước khi ghi log. */
export function redact(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text
    .replace(/("password"\s*:\s*")[^"]*"/gi, '$1***"')
    .replace(/("(?:access|refresh)_token"\s*:\s*")([^"]{6})[^"]*"/gi, '$1$2…"')
    .replace(/("(?:fileToBytes|content|\w*Base64)"\s*:\s*")[^"]{40}[^"]*"/g, '$1<base64 omitted>"');
}

export async function writeLog(data: {
  kind: "AUTH" | "CREATE" | "SEARCH" | "FILE" | "EVENT";
  invoiceId?: string | null;
  method?: string;
  url?: string;
  requestBody?: string | null;
  status?: number | null;
  responseBody?: string | null;
  durationMs?: number;
  error?: string | null;
  note?: string | null;
}) {
  try {
    await prisma.apiLog.create({
      data: {
        ...data,
        invoiceId: data.invoiceId ?? null,
        requestBody: clip(redact(data.requestBody)),
        responseBody: clip(redact(data.responseBody)),
      },
    });
  } catch (e) {
    console.error("[logger] failed to write log", e);
  }
}

export const logEvent = (invoiceId: string | null, note: string) =>
  writeLog({ kind: "EVENT", invoiceId, note });
