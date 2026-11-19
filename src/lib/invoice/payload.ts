/**
 * Dựng payload createInvoice theo "Đặc tả chi tiết đầu vào lập hóa đơn" (mục 6,
 * tài liệu webservice S-Invoice v2.50). Phạm vi POC: hóa đơn gốc (adjustmentType = 1),
 * hàng hóa thường (selection = 1), tiền VND, thuế suất theo từng dòng.
 */
import { config } from "../config";
import { vndToWords } from "./number-to-words";

import { ALLOWED_TAX, PAYMENT_METHODS } from "./constants";

export { ALLOWED_TAX, PAYMENT_METHODS, TAX_RATES } from "./constants";

export interface InvoiceItemInput {
  name: string;
  code?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  taxPercentage: number;
  note?: string;
}

export interface InvoiceInput {
  orderRef: string;
  buyer: {
    /** Tên người mua (cá nhân) — buyerName, max 100 */
    name?: string;
    /** Tên đơn vị — buyerLegalName, max 400, bắt buộc nếu có MST */
    legalName?: string;
    taxCode?: string;
    address?: string;
    email?: string;
    phone?: string;
    /** buyerNotGetInvoice = 1: người mua không lấy hóa đơn */
    notGetInvoice?: boolean;
  };
  /** paymentMethod: "1".."9" */
  paymentMethod: string;
  /** Free text khi paymentMethod = 5 (KHAC) */
  paymentMethodName?: string;
  /** Đã thanh toán? (generalInvoiceInfo.paymentStatus — bắt buộc) */
  paid: boolean;
  /** Ghi chú dưới danh sách hàng hóa (invoiceNote, max 500) */
  note?: string;
  items: InvoiceItemInput[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const opt = (v: unknown) => str(v) || undefined;

/** Số tiền tối đa 13 chữ số (Maxlength 13 cho itemTotalAmountWithoutTax / totalAmountWithTax). */
const MAX_AMOUNT = 9_999_999_999_999;

export function validateInput(raw: unknown): { ok: true; value: InvoiceInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const i = raw as Record<string, unknown> & { buyer?: Record<string, unknown>; items?: Record<string, unknown>[] };
  if (!i || typeof i !== "object") return { ok: false, errors: ["Body không hợp lệ"] };

  const b = i.buyer ?? {};
  const buyer: InvoiceInput["buyer"] = {
    name: opt(b.name),
    legalName: opt(b.legalName),
    taxCode: opt(b.taxCode),
    address: opt(b.address),
    email: opt(b.email),
    phone: opt(b.phone),
    notGetInvoice: b.notGetInvoice === true,
  };

  const max = (v: string | undefined, n: number, label: string) => {
    if (v && v.length > n) errors.push(`${label} tối đa ${n} ký tự`);
  };

  if (!str(i.orderRef)) errors.push("orderRef bắt buộc");

  // buyerInfo
  if (!buyer.notGetInvoice) {
    if (!buyer.name && !buyer.legalName) errors.push("Tên người mua hoặc tên đơn vị là bắt buộc (buyerNotGetInvoice = 0)");
    if (!buyer.address) errors.push("Địa chỉ người mua là bắt buộc (buyerNotGetInvoice = 0)");
  }
  if (buyer.taxCode) {
    if (!/^\d{10}(-\d{3})?$/.test(buyer.taxCode)) errors.push("MST người mua phải dạng 0312770607 hoặc 0312770607-001");
    if (!buyer.legalName) errors.push("Tên đơn vị (buyerLegalName) bắt buộc khi có MST người mua");
  }
  if (buyer.email) {
    const bad = buyer.email.split(";").map((e) => e.trim()).filter((e) => !/^\S+@\S+\.\S+$/.test(e));
    if (bad.length) errors.push(`Email không hợp lệ: ${bad.join(", ")} (nhiều email cách nhau bởi ";")`);
  }
  max(buyer.name, 100, "Tên người mua");
  max(buyer.legalName, 400, "Tên đơn vị");
  max(buyer.address, 1200, "Địa chỉ");
  max(buyer.phone, 15, "Số điện thoại");
  max(buyer.email, 2000, "Email");

  // payments
  const pm = PAYMENT_METHODS.find((p) => p.code === str(i.paymentMethod));
  if (!pm) errors.push("Hình thức thanh toán không hợp lệ (paymentMethod 1-9)");
  const paymentMethodName = pm?.code === "5" ? str(i.paymentMethodName) || pm.name : pm?.name ?? "";
  max(paymentMethodName, 50, "Tên hình thức thanh toán");

  max(opt(i.note), 500, "Ghi chú hóa đơn");

  // itemInfo
  if (!Array.isArray(i.items) || i.items.length === 0) errors.push("Cần ít nhất 1 dòng hàng");
  const items: InvoiceItemInput[] = (i.items ?? []).map((it, idx) => {
    const n = idx + 1;
    const item: InvoiceItemInput = {
      name: str(it.name),
      code: opt(it.code),
      unit: str(it.unit),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      taxPercentage: Number(it.taxPercentage),
      note: opt(it.note),
    };
    if (!item.name) errors.push(`Dòng ${n}: tên hàng bắt buộc`);
    if (!item.unit) errors.push(`Dòng ${n}: đơn vị tính bắt buộc`);
    if (!(item.quantity > 0)) errors.push(`Dòng ${n}: số lượng phải > 0`);
    if (!(item.unitPrice >= 0)) errors.push(`Dòng ${n}: đơn giá phải >= 0`);
    if (item.quantity * item.unitPrice > MAX_AMOUNT) errors.push(`Dòng ${n}: thành tiền vượt quá 13 chữ số`);
    if (!ALLOWED_TAX.includes(item.taxPercentage)) errors.push(`Dòng ${n}: thuế suất phải thuộc -2/-1/0/5/8/10`);
    max(item.name, 500, `Dòng ${n}: tên hàng`);
    max(item.unit, 300, `Dòng ${n}: đơn vị tính`);
    max(item.code, 50, `Dòng ${n}: mã hàng`);
    max(item.note, 300, `Dòng ${n}: ghi chú`);
    return item;
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      orderRef: str(i.orderRef),
      buyer,
      paymentMethod: pm!.code,
      paymentMethodName,
      paid: i.paid !== false,
      note: opt(i.note),
      items,
    },
  };
}

/** Bỏ các key undefined/"" để payload gọn, đúng tinh thần "không bắt buộc thì không gửi". */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

/** Dựng payload createInvoice (mục 6 + 7.2). */
export function buildCreateInvoicePayload(input: InvoiceInput, transactionUuid: string) {
  const lines = input.items.map((it, idx) => {
    const amount = Math.round(it.quantity * it.unitPrice);
    // -2 / -1: không có tiền thuế
    const tax = it.taxPercentage > 0 ? Math.round((amount * it.taxPercentage) / 100) : 0;
    return compact({
      lineNumber: idx + 1,
      selection: 1, // 1 = Hàng hóa
      itemCode: it.code,
      itemName: it.name,
      unitName: it.unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      itemTotalAmountWithoutTax: amount,
      taxPercentage: it.taxPercentage,
      taxAmount: tax,
      itemTotalAmountWithTax: amount + tax,
      discount: 0,
      itemDiscount: 0,
      itemNote: it.note,
    }) as {
      lineNumber: number; selection: number; itemName: string; unitName: string; quantity: number; unitPrice: number;
      itemTotalAmountWithoutTax: number; taxPercentage: number; taxAmount: number; itemTotalAmountWithTax: number;
      itemCode?: string; discount: number; itemDiscount: number; itemNote?: string;
    };
  });

  // taxBreakdowns: mỗi mức thuế chỉ xuất hiện 1 lần
  const breakdown = new Map<number, { taxableAmount: number; taxAmount: number }>();
  for (const l of lines) {
    const b = breakdown.get(l.taxPercentage) ?? { taxableAmount: 0, taxAmount: 0 };
    b.taxableAmount += l.itemTotalAmountWithoutTax;
    b.taxAmount += l.taxAmount;
    breakdown.set(l.taxPercentage, b);
  }

  const totalWithoutTax = lines.reduce((s, l) => s + l.itemTotalAmountWithoutTax, 0);
  const totalTax = lines.reduce((s, l) => s + l.taxAmount, 0);
  const total = totalWithoutTax + totalTax;

  return {
    generalInvoiceInfo: compact({
      transactionUuid,
      invoiceType: config.invoiceType,
      templateCode: config.templateCode,
      invoiceSeries: config.invoiceSeries,
      // invoiceIssuedDate: bỏ trống => Viettel lấy giờ hệ thống GMT+7, tránh lỗi trình tự ngày lập
      currencyCode: "VND",
      exchangeRate: 1,
      adjustmentType: "1", // hóa đơn gốc
      paymentStatus: input.paid,
      cusGetInvoiceRight: true,
      invoiceNote: input.note,
    }),
    buyerInfo: compact({
      buyerName: input.buyer.name,
      buyerLegalName: input.buyer.legalName,
      buyerTaxCode: input.buyer.taxCode,
      buyerAddressLine: input.buyer.address,
      buyerEmail: input.buyer.email,
      buyerPhoneNumber: input.buyer.phone,
      buyerNotGetInvoice: input.buyer.notGetInvoice ? 1 : 0,
    }),
    payments: [{ paymentMethod: input.paymentMethod, paymentMethodName: input.paymentMethodName }],
    itemInfo: lines,
    summarizeInfo: {
      sumOfTotalLineAmountWithoutTax: totalWithoutTax,
      totalAmountWithoutTax: totalWithoutTax,
      totalTaxAmount: totalTax,
      totalAmountWithTax: total,
      totalAmountAfterDiscount: totalWithoutTax,
      totalAmountWithTaxInWords: vndToWords(total),
      discountAmount: 0, // bắt buộc
    },
    taxBreakdowns: [...breakdown.entries()].map(([taxPercentage, b]) => ({ taxPercentage, ...b })),
  };
}

export type CreateInvoicePayload = ReturnType<typeof buildCreateInvoicePayload>;

/** Tên hiển thị người mua cho danh sách. */
export const buyerDisplayName = (b: InvoiceInput["buyer"]) =>
  b.legalName || b.name || (b.notGetInvoice ? "Người mua không lấy hóa đơn" : "—");
