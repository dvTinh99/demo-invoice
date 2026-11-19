import { prisma } from "@/lib/db";
import { config, MOCK_SCENARIOS } from "@/lib/config";
import { errorResponse } from "@/lib/http-utils";
import { validateInput } from "@/lib/invoice/payload";
import { issueInvoice } from "@/lib/invoice/service";

/** Gọi Viettel có thể mất tới 90s/request (login + retry + đối soát) — cần vượt mặc định của Vercel. */
export const maxDuration = 300;

export async function GET() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, orderRef: true, status: true, buyerName: true, totalAmount: true, invoiceNo: true,
      transactionUuid: true, idempotencyKey: true, attempts: true, errorCode: true, errorMessage: true,
      mockScenario: true, createdAt: true, issuedAt: true,
    },
  });
  return Response.json({ invoices });
}

export async function POST(req: Request) {
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return Response.json(
      { error: "IDEMPOTENCY_KEY_REQUIRED", message: "Header Idempotency-Key (8-128 ký tự) là bắt buộc" },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  const v = validateInput(body?.input);
  if (!v.ok) return Response.json({ error: "VALIDATION", message: v.errors.join("; "), errors: v.errors }, { status: 400 });

  let mockScenario: string | null = null;
  if (config.mockMode && body?.mockScenario && body.mockScenario !== "success") {
    if (!(body.mockScenario in MOCK_SCENARIOS)) {
      return Response.json({ error: "VALIDATION", message: "mockScenario không hợp lệ" }, { status: 400 });
    }
    mockScenario = body.mockScenario;
  }

  try {
    const { invoice, replayed } = await issueInvoice({ idempotencyKey, input: v.value, mockScenario });
    return Response.json(
      { invoice, replayed },
      { status: replayed ? 200 : 201, headers: replayed ? { "Idempotent-Replayed": "true" } : {} },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
