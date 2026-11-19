/** Danh mục dùng chung client/server (không phụ thuộc env). */

/** Mục 6 · taxPercentage: -2 không thuế, -1 không kê khai tính/nộp thuế, 0/5/8/10 %. */
export const TAX_RATES = [
  { value: 10, label: "10%" },
  { value: 8, label: "8%" },
  { value: 5, label: "5%" },
  { value: 0, label: "0%" },
  { value: -2, label: "KCT (không thuế)" },
  { value: -1, label: "KKKNT (không kê khai, tính nộp thuế)" },
] as const;
export const ALLOWED_TAX: number[] = TAX_RATES.map((t) => t.value);

/** Mục 6 · payments: paymentMethod (mã) ↔ paymentMethodName (bắt buộc). */
export const PAYMENT_METHODS = [
  { code: "1", name: "TM" },
  { code: "2", name: "CK" },
  { code: "3", name: "TM/CK" },
  { code: "4", name: "DTCN" },
  { code: "5", name: "KHAC" },
  { code: "6", name: "Tiền mặt" },
  { code: "7", name: "Chuyển khoản" },
  { code: "8", name: "Tiền mặt/Chuyển khoản" },
  { code: "9", name: "Thẻ quốc tế" },
] as const;
