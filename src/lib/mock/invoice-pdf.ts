import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, degrees, rgb, type RGB } from "pdf-lib";
import QRCode from "qrcode";

/**
 * Bản thể hiện hóa đơn GTGT cho Mock server, dựng theo bố cục mẫu hóa đơn điện tử (TT78):
 * tiêu đề + ký hiệu/số, đơn vị bán, người mua, bảng hàng hóa (8 cột), tổng hợp theo thuế suất,
 * số tiền bằng chữ, chữ ký số, mã tra cứu. Font Liberation Serif (SIL OFL) hỗ trợ tiếng Việt.
 * Chỉ để demo — bản thể hiện thật do Viettel sinh từ mẫu đã đăng ký.
 */

interface PayloadItem {
  lineNumber: number;
  itemName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  itemTotalAmountWithoutTax: number;
  taxPercentage: number;
  taxAmount: number;
  itemNote?: string;
}

interface Payload {
  generalInvoiceInfo: { invoiceNote?: string; currencyCode?: string };
  buyerInfo: {
    buyerName?: string;
    buyerLegalName?: string;
    buyerTaxCode?: string;
    buyerAddressLine?: string;
    buyerNotGetInvoice?: number;
  };
  payments?: { paymentMethodName?: string }[];
  itemInfo: PayloadItem[];
  summarizeInfo: {
    totalAmountWithoutTax: number;
    totalTaxAmount: number;
    totalAmountWithTax: number;
    totalAmountWithTaxInWords: string;
  };
  taxBreakdowns?: { taxPercentage: number; taxableAmount: number; taxAmount: number }[];
}

export interface InvoicePdfData {
  templateCode: string;
  invoiceSeries: string;
  invoiceNo: string;
  reservationCode: string;
  transactionUuid: string;
  issuedAt: Date;
  supplierTaxCode: string;
  codeOfTax?: string | null;
  seller: { name: string; address: string; phone: string; bankAccount: string };
  lookupUrl: string;
  payload: Payload;
}

// ===== Font =====
const FONT_FILES = {
  regular: "LiberationSerif-Regular.ttf",
  bold: "LiberationSerif-Bold.ttf",
  italic: "LiberationSerif-Italic.ttf",
  boldItalic: "LiberationSerif-BoldItalic.ttf",
} as const;
type FontKey = keyof typeof FONT_FILES;

let fontBytes: Promise<Record<FontKey, Uint8Array>> | null = null;
function loadFontBytes() {
  // assets/fonts được đưa vào bundle serverless qua outputFileTracingIncludes (next.config.ts)
  fontBytes ??= Promise.all(
    (Object.keys(FONT_FILES) as FontKey[]).map(async (k) => [k, await readFile(path.join(process.cwd(), "assets/fonts", FONT_FILES[k]))] as const),
  ).then((entries) => Object.fromEntries(entries) as unknown as Record<FontKey, Uint8Array>);
  return fontBytes;
}

// ===== Bố cục =====
const W = 595.28; // A4
const H = 841.89;
const M = 32; // lề nội dung
const CW = W - 2 * M;
const BOTTOM = M + 28; // chừa chỗ số trang

const NAVY = rgb(0.09, 0.2, 0.45);
const RED = rgb(0.75, 0.1, 0.1);
const GREEN = rgb(0.05, 0.5, 0.2);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.55, 0.6, 0.7);
const HEAD_BG = rgb(0.9, 0.93, 0.98);

/** Bảng hàng hóa 8 cột theo mẫu: (6) = (4) x (5), (8) = (6) x (7). */
const COLS = [
  { title: "STT\n(No.)", w: 26, align: "center" },
  { title: "Tên hàng hóa, dịch vụ\n(Description)", w: 165, align: "left" },
  { title: "Đơn vị tính\n(Unit)", w: 40, align: "center" },
  { title: "Số lượng\n(Quantity)", w: 44, align: "right" },
  { title: "Đơn giá\n(Unit price)", w: 64, align: "right" },
  { title: "Thành tiền chưa có thuế GTGT\n(Amount)", w: 80, align: "right" },
  { title: "Thuế suất\n(VAT rate)", w: 36, align: "center" },
  { title: "Tiền thuế GTGT\n(VAT amount)", w: CW - 455, align: "right" },
] as const;
const COL_INDEX = ["1", "2", "3", "4", "5", "6 = 4 x 5", "7", "8 = 6 x 7"];
const colX = (i: number) => M + COLS.slice(0, i).reduce((s, c) => s + c.w, 0);

const money = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
const qty = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(n);
const taxLabel = (v: number) => (v === -2 ? "KCT" : v === -1 ? "KKKNT" : `${v}%`);

function vnDateParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** invoiceNo của Viettel = <ký hiệu><số thứ tự>; trên bản thể hiện chỉ in số thứ tự (tối đa 8 chữ số). */
function displayNumber(invoiceNo: string, series: string) {
  const seq = invoiceNo.startsWith(series) ? invoiceNo.slice(series.length) : invoiceNo;
  return /^\d+$/.test(seq) ? seq.padStart(8, "0") : seq;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];

  constructor(
    private doc: PDFDocument,
    readonly f: Record<FontKey, PDFFont>,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - M - 4;
    // Khung viền đôi
    this.page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: NAVY, borderWidth: 1.4 });
    this.page.drawRectangle({ x: 21.5, y: 21.5, width: W - 43, height: H - 43, borderColor: NAVY, borderWidth: 0.5 });
    // Watermark
    const wm = "BẢN MOCK – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ";
    const size = 26;
    const tw = this.f.bold.widthOfTextAtSize(wm, size);
    const a = (32 * Math.PI) / 180;
    this.page.drawText(wm, {
      x: W / 2 - (tw / 2) * Math.cos(a), y: H / 2 - (tw / 2) * Math.sin(a),
      size, font: this.f.bold, color: RED, opacity: 0.08, rotate: degrees(32),
    });
  }

  ensure(h: number) {
    if (this.y - h < BOTTOM) {
      this.newPage();
      return true;
    }
    return false;
  }

  text(s: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    this.page.drawText(s, { x, y, size: o.size ?? 10, font: o.font ?? this.f.regular, color: o.color ?? BLACK });
  }

  width(s: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(s, size);
  }

  aligned(s: string, x: number, w: number, y: number, align: "left" | "center" | "right", o: { font?: PDFFont; size?: number; color?: RGB } = {}) {
    const font = o.font ?? this.f.regular;
    const size = o.size ?? 10;
    const tw = font.widthOfTextAtSize(s, size);
    const tx = align === "left" ? x : align === "center" ? x + (w - tw) / 2 : x + w - tw;
    this.text(s, tx, y, { ...o, font, size });
  }

  wrap(s: string, font: PDFFont, size: number, maxW: number): string[] {
    const out: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(cand, size) <= maxW) {
          line = cand;
          continue;
        }
        if (line) out.push(line);
        // Từ quá dài: cắt theo ký tự
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxW) {
          let n = rest.length - 1;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > maxW) n--;
          out.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      out.push(line);
    }
    return out;
  }

  hline(y: number, x1 = M, x2 = W - M, color = LINE, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
  }

  vline(x: number, y1: number, y2: number) {
    this.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color: LINE, thickness: 0.6 });
  }

  /** Dòng "Nhãn (English): giá trị", giá trị tự xuống dòng. */
  field(label: string, value: string, o: { x?: number; w?: number; bold?: boolean; color?: RGB; size?: number } = {}) {
    const x = o.x ?? M;
    const w = o.w ?? CW;
    const size = o.size ?? 10;
    const lw = this.width(label + " ", this.f.regular, size);
    const vf = o.bold ? this.f.bold : this.f.regular;
    const lines = this.wrap(value || " ", vf, size, w - lw);
    this.ensure(lines.length * 13 + 2);
    this.text(label, x, this.y, { size, color: GRAY });
    lines.forEach((l, i) => this.text(l, x + lw, this.y - i * 13, { font: vf, size, color: o.color }));
    this.y -= lines.length * 13 + 2;
  }
}

function drawQr(w: Writer, text: string, x: number, top: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / (n + 2);
  w.page.drawRectangle({ x, y: top - size, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) {
        w.page.drawRectangle({ x: x + (c + 1) * cell, y: top - (r + 2) * cell, width: cell + 0.05, height: cell + 0.05, color: BLACK });
      }
    }
  }
}

function drawTableHeader(w: Writer) {
  const size = 8;
  const titles = COLS.map((c) => w.wrap(c.title, w.f.bold, size, c.w - 4));
  const h1 = Math.max(...titles.map((t) => t.length)) * 10 + 6;
  const h2 = 13;
  const top = w.y;
  w.page.drawRectangle({ x: M, y: top - h1 - h2, width: CW, height: h1 + h2, color: HEAD_BG });
  COLS.forEach((c, i) => {
    const x = colX(i);
    const lines = titles[i];
    const startY = top - (h1 - lines.length * 10) / 2 - 8;
    lines.forEach((l, j) => w.aligned(l, x + 2, c.w - 4, startY - j * 10, "center", { font: j === lines.length - 1 && l.startsWith("(") ? w.f.italic : w.f.bold, size }));
    w.aligned(COL_INDEX[i], x, c.w, top - h1 - 9.5, "center", { font: w.f.italic, size: 7.5, color: GRAY });
  });
  w.hline(top);
  w.hline(top - h1);
  w.hline(top - h1 - h2);
  for (let i = 0; i <= COLS.length; i++) w.vline(i === COLS.length ? W - M : colX(i), top, top - h1 - h2);
  w.y = top - h1 - h2;
}

export async function buildInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const f = {} as Record<FontKey, PDFFont>;
  for (const k of Object.keys(FONT_FILES) as FontKey[]) f[k] = await doc.embedFont(bytes[k], { subset: true });

  const p = d.payload;
  const { day, month, year } = vnDateParts(d.issuedAt);
  const serial = `${d.templateCode.split("/")[0]}${d.invoiceSeries}`; // TT78: ký hiệu mẫu số (1 số) + ký hiệu hóa đơn
  const number = displayNumber(d.invoiceNo, d.invoiceSeries);

  doc.setTitle(`Hóa đơn GTGT ${serial} - ${number}`);
  doc.setAuthor(d.seller.name);
  doc.setSubject("Bản thể hiện hóa đơn điện tử (Mock)");
  doc.setCreator("Mock Viettel S-Invoice");

  const w = new Writer(doc, f);
  w.newPage();

  // ===== Tiêu đề =====
  const top = w.y;
  drawQr(w, [d.supplierTaxCode, serial, number, `${day}/${month}/${year}`, d.payload.summarizeInfo.totalAmountWithTax, d.reservationCode].join("|"), M, top, 72);
  w.aligned("HÓA ĐƠN GIÁ TRỊ GIA TĂNG", M, CW, top - 20, "center", { font: f.bold, size: 17, color: NAVY });
  w.aligned("(VAT INVOICE)", M, CW, top - 34, "center", { font: f.bold, size: 10, color: NAVY });
  w.aligned("(Bản thể hiện của hóa đơn điện tử)", M, CW, top - 48, "center", { font: f.italic, size: 9.5 });
  w.aligned(`Ngày (Date) ${day} tháng (month) ${month} năm (year) ${year}`, M, CW, top - 63, "center", { font: f.italic, size: 10 });
  if (d.codeOfTax) w.aligned(`Mã của CQT: ${d.codeOfTax}`, M, CW, top - 77, "center", { font: f.bold, size: 9.5 });

  const rx = W - M - 128;
  w.text("Ký hiệu (Serial):", rx, top - 22, { size: 9.5, color: GRAY });
  w.text(serial, rx + 72, top - 22, { font: f.bold, size: 10.5 });
  w.text("Số (No.):", rx, top - 40, { size: 9.5, color: GRAY });
  w.text(number, rx + 72, top - 40, { font: f.bold, size: 13, color: RED });
  w.y = top - (d.codeOfTax ? 90 : 82);
  w.hline(w.y, M, W - M, NAVY, 1);
  w.y -= 15;

  // ===== Đơn vị bán =====
  w.field("Đơn vị bán hàng (Seller):", d.seller.name.toUpperCase(), { bold: true, color: NAVY, size: 10.5 });
  w.field("Mã số thuế (Tax code):", d.supplierTaxCode, { bold: true });
  w.field("Địa chỉ (Address):", d.seller.address);
  const half = CW / 2;
  const yRow = w.y;
  w.field("Điện thoại (Tel):", d.seller.phone, { w: half });
  w.y = yRow;
  w.field("Số tài khoản (A/C No.):", d.seller.bankAccount, { x: M + half, w: half });
  w.y -= 2;
  w.hline(w.y + 8);
  w.y -= 8;

  // ===== Người mua =====
  const b = p.buyerInfo;
  if (b.buyerNotGetInvoice === 1 && !b.buyerName && !b.buyerLegalName) {
    w.field("Họ tên người mua hàng (Buyer):", "Người mua không lấy hóa đơn", { bold: true });
  } else {
    w.field("Họ tên người mua hàng (Buyer):", b.buyerName ?? "");
    w.field("Tên đơn vị (Company name):", (b.buyerLegalName ?? "").toUpperCase(), { bold: true });
    w.field("Mã số thuế (Tax code):", b.buyerTaxCode ?? "", { bold: true });
    w.field("Địa chỉ (Address):", b.buyerAddressLine ?? "");
  }
  const yPay = w.y;
  w.field("Hình thức thanh toán (Payment method):", p.payments?.[0]?.paymentMethodName ?? "", { w: half + 60 });
  w.y = yPay;
  w.field("Đơn vị tiền tệ (Currency):", p.generalInvoiceInfo.currencyCode ?? "VND", { x: M + half + 70, w: half - 70 });
  w.y -= 6;

  // ===== Bảng hàng hóa =====
  w.ensure(60);
  drawTableHeader(w);
  const rowSize = 9.5;
  for (const it of p.itemInfo) {
    const name = it.itemNote ? `${it.itemName}\n${it.itemNote}` : it.itemName;
    const nameLines = w.wrap(name, f.regular, rowSize, COLS[1].w - 6);
    const h = nameLines.length * 12 + 6;
    if (w.ensure(h)) drawTableHeader(w);
    const yTop = w.y;
    const base = yTop - 12;
    const cells = [String(it.lineNumber), "", it.unitName, qty(it.quantity), money(it.unitPrice), money(it.itemTotalAmountWithoutTax), taxLabel(it.taxPercentage), it.taxPercentage >= 0 ? money(it.taxAmount) : ""];
    cells.forEach((v, i) => {
      if (i === 1) nameLines.forEach((l, j) => w.text(l, colX(1) + 3, base - j * 12, { size: rowSize, font: j > 0 && it.itemNote && j >= nameLines.length - 1 ? f.italic : f.regular }));
      else w.aligned(v, colX(i) + 3, COLS[i].w - 6, base, COLS[i].align, { size: rowSize });
    });
    w.y = yTop - h;
    for (let i = 0; i <= COLS.length; i++) w.vline(i === COLS.length ? W - M : colX(i), yTop, w.y);
    w.hline(w.y);
  }

  // ===== Tổng hợp =====
  const s = p.summarizeInfo;
  const breakdowns = [...(p.taxBreakdowns ?? [])].sort((a, b) => b.taxPercentage - a.taxPercentage);
  const sumRows: { label: string; amount?: string; rate?: string; tax?: string; bold?: boolean; total?: string }[] = [
    ...breakdowns.map((t) => ({ label: `Tổng hợp theo thuế suất ${taxLabel(t.taxPercentage)}`, amount: money(t.taxableAmount), rate: taxLabel(t.taxPercentage), tax: t.taxPercentage >= 0 ? money(t.taxAmount) : "" })),
    { label: "Cộng tiền hàng hóa, dịch vụ (Total amount)", amount: money(s.totalAmountWithoutTax), tax: money(s.totalTaxAmount), bold: true },
    { label: "Tổng cộng tiền thanh toán (Total payment)", total: money(s.totalAmountWithTax), bold: true },
  ];
  const labelW = colX(5) - M;
  for (const r of sumRows) {
    const h = 17;
    w.ensure(h);
    const yTop = w.y;
    const base = yTop - 12;
    const lf = r.bold ? f.bold : f.regular;
    w.aligned(r.label, M + 6, labelW - 12, base, r.total ? "left" : "right", { font: lf, size: 9.5 });
    if (r.total) {
      w.aligned(r.total, colX(5), W - M - colX(5) - 4, base, "right", { font: f.bold, size: 11, color: RED });
      w.vline(colX(5), yTop, yTop - h);
    } else {
      w.aligned(r.amount ?? "", colX(5) + 3, COLS[5].w - 6, base, "right", { font: lf, size: 9.5 });
      w.aligned(r.rate ?? "", colX(6) + 3, COLS[6].w - 6, base, "center", { font: lf, size: 9.5 });
      w.aligned(r.tax ?? "", colX(7) + 3, COLS[7].w - 6, base, "right", { font: lf, size: 9.5 });
      for (const i of [5, 6, 7]) w.vline(colX(i), yTop, yTop - h);
    }
    w.vline(M, yTop, yTop - h);
    w.vline(W - M, yTop, yTop - h);
    w.y = yTop - h;
    w.hline(w.y);
  }

  w.y -= 16;
  const wordsLabel = "Số tiền viết bằng chữ (Amount in words): ";
  const wordsLines = w.wrap(s.totalAmountWithTaxInWords, f.boldItalic, 10, CW - w.width(wordsLabel, f.regular, 10));
  w.ensure(wordsLines.length * 13);
  w.text(wordsLabel, M, w.y, { size: 10, color: GRAY });
  wordsLines.forEach((l, i) => w.text(l, M + w.width(wordsLabel, f.regular, 10), w.y - i * 13, { font: f.boldItalic, size: 10 }));
  w.y -= wordsLines.length * 13 + 2;
  if (p.generalInvoiceInfo.invoiceNote) w.field("Ghi chú (Note):", p.generalInvoiceInfo.invoiceNote);

  // ===== Chữ ký =====
  w.y -= 10;
  w.ensure(120);
  const sigTop = w.y;
  const colW = CW / 2;
  w.aligned("NGƯỜI MUA HÀNG (Buyer)", M, colW, sigTop, "center", { font: f.bold, size: 10 });
  w.aligned("(Chữ ký số (nếu có))", M, colW, sigTop - 13, "center", { font: f.italic, size: 9 });
  w.aligned("NGƯỜI BÁN HÀNG (Seller)", M + colW, colW, sigTop, "center", { font: f.bold, size: 10 });
  w.aligned("(Chữ ký điện tử, chữ ký số)", M + colW, colW, sigTop - 13, "center", { font: f.italic, size: 9 });

  const boxW = 240;
  const boxH = 54;
  const boxX = M + colW + (colW - boxW) / 2;
  const boxTop = sigTop - 26;
  w.page.drawRectangle({ x: boxX, y: boxTop - boxH, width: boxW, height: boxH, borderColor: GREEN, borderWidth: 1, color: rgb(0.94, 0.99, 0.95) });
  w.text("Signature Valid (Mock)", boxX + 8, boxTop - 14, { font: f.bold, size: 10, color: GREEN });
  const signer = w.wrap(`Ký bởi: ${d.seller.name.toUpperCase()}`, f.regular, 8.5, boxW - 16).slice(0, 2);
  signer.forEach((l, i) => w.text(l, boxX + 8, boxTop - 27 - i * 10.5, { size: 8.5, color: GREEN }));
  w.text(`Ký ngày: ${day}/${month}/${year}`, boxX + 8, boxTop - 27 - signer.length * 10.5, { size: 8.5, color: GREEN });
  w.y = boxTop - boxH - 18;

  // ===== Chân trang =====
  const footer = [
    { t: "(Cần kiểm tra, đối chiếu khi lập, giao, nhận hóa đơn)", font: f.italic },
    { t: `Mã tra cứu (Lookup code): ${d.reservationCode}   ·   Tra cứu tại: ${d.lookupUrl}`, font: f.regular },
    { t: `Bản thể hiện do Mock S-Invoice sinh ra, không có giá trị pháp lý · transactionUuid: ${d.transactionUuid}`, font: f.italic },
  ];
  w.ensure(footer.length * 12);
  for (const l of footer) {
    w.aligned(l.t, M, CW, w.y, "center", { font: l.font, size: 8.5, color: GRAY });
    w.y -= 12;
  }

  // Số trang
  w.pages.forEach((pg, i) => {
    const t = `Trang ${i + 1}/${w.pages.length}`;
    pg.drawText(t, { x: W - M - f.italic.widthOfTextAtSize(t, 8), y: 30, size: 8, font: f.italic, color: GRAY });
  });

  return Buffer.from(await doc.save());
}
