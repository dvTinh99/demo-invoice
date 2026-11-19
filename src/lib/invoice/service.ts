import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Invoice } from "@prisma/client";
import { config, validateConfig } from "../config";
import { prisma } from "../db";
import { logEvent } from "../logger";
import { createInvoice, searchByTransactionUuid } from "../viettel/api";
import { ViettelAmbiguousError, ViettelAuthError, ViettelBusinessError } from "../viettel/errors";
import { buildCreateInvoicePayload, buyerDisplayName, type InvoiceInput } from "./payload";

/**
 * PROCESSING      : đang gửi createInvoice (đang giữ khóa)
 * ISSUED          : đã có số hóa đơn
 * AWAITING_NUMBER : Viettel đã nhận nhưng trả invoiceNo rỗng (bất đồng bộ) — KHÔNG được gửi lại, chỉ tra cứu
 * FAILED          : chắc chắn chưa lập (lỗi nghiệp vụ / xác thực) — được phép gửi lại
 * UNKNOWN         : timeout / mạng / 5xx — phải đối soát trước khi gửi lại
 */
export type InvoiceStatus = "PROCESSING" | "ISSUED" | "AWAITING_NUMBER" | "FAILED" | "UNKNOWN";

/**
 * PROCESSING lâu hơn ngưỡng này coi như request đã chết (crash giữa chừng).
 * Phải lớn hơn timeout: Viettel yêu cầu chờ hết timeout (>= 90s) mới gửi lại cùng transactionUuid,
 * vì 2 request đồng thời cùng transactionUuid sẽ tạo ra 2 hóa đơn.
 */
const staleLockMs = () => config.timeoutMs + 30_000;

export class ServiceError extends Error {
  constructor(message: string, public httpStatus: number, public code: string) {
    super(message);
  }
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const hashRequest = (input: InvoiceInput, mockScenario: string | null) =>
  createHash("sha256").update(stableStringify({ input, mockScenario })).digest("hex");

const isStale = (inv: Invoice) =>
  inv.status === "PROCESSING" && (!inv.lockedAt || Date.now() - inv.lockedAt.getTime() > staleLockMs());

/**
 * Xuất hóa đơn idempotent.
 *  1. Cùng Idempotency-Key + cùng payload  => trả lại kết quả cũ (không gọi Viettel lần 2)
 *  2. Cùng Idempotency-Key + khác payload  => 422
 *  3. Request song song cùng key            => unique constraint chặn, request sau nhận 409 / kết quả cũ
 */
export async function issueInvoice(args: {
  idempotencyKey: string;
  input: InvoiceInput;
  mockScenario: string | null;
}): Promise<{ invoice: Invoice; replayed: boolean }> {
  const configErrors = validateConfig();
  if (configErrors.length) throw new ServiceError(`Cấu hình Viettel không hợp lệ: ${configErrors.join("; ")}`, 500, "CONFIG_INVALID");

  const requestHash = hashRequest(args.input, args.mockScenario);

  const existing = await prisma.invoice.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
  if (existing) return replay(existing, requestHash);

  const transactionUuid = randomUUID();
  const payload = buildCreateInvoicePayload(args.input, transactionUuid);

  let invoice: Invoice;
  try {
    invoice = await prisma.invoice.create({
      data: {
        idempotencyKey: args.idempotencyKey,
        requestHash,
        transactionUuid,
        orderRef: args.input.orderRef,
        status: "PROCESSING",
        lockedAt: new Date(),
        buyerName: buyerDisplayName(args.input.buyer),
        totalAmount: payload.summarizeInfo.totalAmountWithTax,
        input: JSON.stringify(args.input),
        payload: JSON.stringify(payload),
        mockScenario: args.mockScenario,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Request song song đã chiếm key trước
      const winner = await prisma.invoice.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
      if (winner) return replay(winner, requestHash);
    }
    throw e;
  }

  await logEvent(invoice.id, `Tạo bản ghi PROCESSING, idempotencyKey=${args.idempotencyKey}, transactionUuid=${transactionUuid}`);
  return { invoice: await submit(invoice), replayed: false };
}

async function replay(inv: Invoice, requestHash: string): Promise<{ invoice: Invoice; replayed: boolean }> {
  if (inv.requestHash !== requestHash) {
    throw new ServiceError(
      "Idempotency-Key đã được dùng cho một yêu cầu có nội dung khác",
      422,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
  await logEvent(inv.id, `Nhận lại request trùng Idempotency-Key (status hiện tại: ${inv.status}) → không gọi createInvoice`);

  if (inv.status === "PROCESSING" && !isStale(inv)) {
    throw new ServiceError("Yêu cầu với Idempotency-Key này đang được xử lý", 409, "IN_PROGRESS");
  }
  if (inv.status === "UNKNOWN" || inv.status === "AWAITING_NUMBER" || isStale(inv)) {
    return { invoice: await reconcile(inv.id), replayed: true };
  }
  return { invoice: inv, replayed: true };
}

/** Gửi createInvoice với transactionUuid cố định của bản ghi. */
async function submit(inv: Invoice): Promise<Invoice> {
  const payload = JSON.parse(inv.payload);
  const attempts = inv.attempts + 1;
  await prisma.invoice.update({ where: { id: inv.id }, data: { attempts, lastSentAt: new Date() } });

  try {
    const result = await createInvoice(payload, { invoiceId: inv.id, mockScenario: inv.mockScenario });
    if (!result.invoiceNo) {
      await logEvent(inv.id, "Viettel đã nhận hóa đơn nhưng invoiceNo rỗng (xử lý bất đồng bộ) → AWAITING_NUMBER, tra cứu lại sau");
      return prisma.invoice.update({
        where: { id: inv.id },
        data: {
          status: "AWAITING_NUMBER",
          reservationCode: result.reservationCode || null,
          viettelTxnId: result.transactionID || null,
          codeOfTax: result.codeOfTax,
          errorCode: null,
          errorMessage: "Chờ Viettel cấp số hóa đơn — chạy đối soát sau 30-90s",
          lockedAt: null,
        },
      });
    }
    await logEvent(inv.id, `Lập hóa đơn thành công: ${result.invoiceNo}`);
    return prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: "ISSUED",
        invoiceNo: result.invoiceNo,
        reservationCode: result.reservationCode,
        viettelTxnId: result.transactionID,
        codeOfTax: result.codeOfTax,
        errorCode: null,
        errorMessage: null,
        issuedAt: new Date(),
        lockedAt: null,
      },
    });
  } catch (e) {
    if (e instanceof ViettelBusinessError || e instanceof ViettelAuthError) {
      const code = e instanceof ViettelBusinessError ? e.code : "AUTH_FAILED";
      await logEvent(inv.id, `Viettel từ chối: [${code}] ${e.message} → FAILED (chắc chắn chưa lập hóa đơn)`);
      return prisma.invoice.update({
        where: { id: inv.id },
        data: { status: "FAILED", errorCode: code, errorMessage: e.message, lockedAt: null },
      });
    }
    // Timeout / mạng / 5xx / lỗi khác: KHÔNG biết đã lập hay chưa => UNKNOWN + đối soát ngay
    const reason = e instanceof ViettelAmbiguousError ? e.reason : "ERROR";
    await logEvent(inv.id, `Kết quả không chắc chắn (${reason}: ${(e as Error).message}) → UNKNOWN, tiến hành đối soát`);
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: "UNKNOWN", errorCode: reason, errorMessage: (e as Error).message, lockedAt: null },
    });
    return reconcile(inv.id);
  }
}

/**
 * Đối soát theo transactionUuid:
 *  - tìm thấy      => ISSUED (Viettel đã lập dù client không nhận được response)
 *  - không tìm thấy => giữ UNKNOWN, đánh dấu an toàn để gửi lại (cùng transactionUuid)
 */
export async function reconcile(id: string): Promise<Invoice> {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "ISSUED") return inv;
  if (inv.status === "PROCESSING" && !isStale(inv)) {
    throw new ServiceError("Hóa đơn đang được xử lý, thử lại sau", 409, "IN_PROGRESS");
  }

  try {
    const found = await searchByTransactionUuid(inv.transactionUuid, { invoiceId: inv.id });
    if (!found && inv.status === "AWAITING_NUMBER") {
      await logEvent(inv.id, "Đối soát: Viettel chưa trả số hóa đơn → giữ AWAITING_NUMBER (không gửi lại)");
      return inv;
    }
    if (found) {
      await logEvent(inv.id, `Đối soát: TÌM THẤY hóa đơn ${found.invoiceNo} trên Viettel → ISSUED`);
      return prisma.invoice.update({
        where: { id },
        data: {
          status: "ISSUED",
          invoiceNo: found.invoiceNo,
          reservationCode: found.reservationCode ?? inv.reservationCode,
          viettelTxnId: found.transactionID ?? inv.viettelTxnId,
          codeOfTax: found.codeOfTax ?? inv.codeOfTax,
          errorCode: null,
          errorMessage: null,
          issuedAt: inv.issuedAt ?? new Date(),
          lockedAt: null,
        },
      });
    }
    await logEvent(inv.id, "Đối soát: KHÔNG tìm thấy trên Viettel → có thể gửi lại an toàn với cùng transactionUuid");
    return prisma.invoice.update({
      where: { id },
      data: {
        status: inv.status === "FAILED" ? "FAILED" : "UNKNOWN",
        errorCode: inv.status === "FAILED" ? inv.errorCode : "NOT_FOUND_ON_VIETTEL",
        errorMessage: inv.status === "FAILED" ? inv.errorMessage : "Đối soát không thấy hóa đơn trên Viettel — an toàn để gửi lại",
        lockedAt: null,
      },
    });
  } catch (e) {
    await logEvent(inv.id, `Đối soát thất bại: ${(e as Error).message} → giữ nguyên trạng thái`);
    return prisma.invoice.update({
      where: { id },
      data: { status: inv.status === "PROCESSING" ? "UNKNOWN" : inv.status, lockedAt: null },
    });
  }
}

/**
 * Gửi lại thủ công. Quy tắc an toàn: hóa đơn UNKNOWN luôn được đối soát TRƯỚC,
 * chỉ gửi lại khi chắc chắn Viettel chưa có hóa đơn với transactionUuid này.
 */
export async function retry(id: string): Promise<Invoice> {
  let inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "ISSUED") return inv;
  if (inv.status === "AWAITING_NUMBER") return reconcile(id);

  if (inv.status === "UNKNOWN" || isStale(inv)) {
    // Mục 5.3: chỉ gửi lại cùng transactionUuid sau khi request trước đã timeout (>= 90s)
    const waited = inv.lastSentAt ? Date.now() - inv.lastSentAt.getTime() : Infinity;
    if (waited < config.minResendGapMs) {
      const s = Math.ceil((config.minResendGapMs - waited) / 1000);
      throw new ServiceError(`Phải chờ thêm ${s}s kể từ lần gửi trước mới được gửi lại cùng transactionUuid (quy tắc >= 90s của Viettel)`, 409, "RESEND_TOO_EARLY");
    }
    inv = await reconcile(id);
    if (inv.status === "ISSUED") return inv;
    if (inv.errorCode !== "NOT_FOUND_ON_VIETTEL") {
      throw new ServiceError("Chưa xác định được trạng thái trên Viettel, không gửi lại", 409, "STILL_UNKNOWN");
    }
  }

  // Chiếm khóa nguyên tử: chỉ 1 request được chuyển FAILED/UNKNOWN -> PROCESSING
  const claimed = await prisma.invoice.updateMany({
    where: { id, status: { in: ["FAILED", "UNKNOWN"] } },
    data: { status: "PROCESSING", lockedAt: new Date() },
  });
  if (claimed.count !== 1) throw new ServiceError("Hóa đơn đang được xử lý bởi request khác", 409, "IN_PROGRESS");

  await logEvent(id, `Gửi lại (lần ${inv.attempts + 1}) với cùng transactionUuid=${inv.transactionUuid}`);
  return submit(await prisma.invoice.findUniqueOrThrow({ where: { id } }));
}

/** Đối soát hàng loạt các hóa đơn UNKNOWN hoặc PROCESSING bị treo (job định kỳ). */
export async function reconcileAll() {
  const candidates = await prisma.invoice.findMany({
    where: {
      OR: [
        { status: { in: ["UNKNOWN", "AWAITING_NUMBER"] } },
        { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - staleLockMs()) } },
      ],
    },
  });
  const results = [];
  for (const c of candidates) {
    const r = await reconcile(c.id).catch((e) => ({ ...c, errorMessage: (e as Error).message }));
    results.push({ id: c.id, orderRef: c.orderRef, before: c.status, after: r.status, invoiceNo: r.invoiceNo });
  }
  return results;
}
