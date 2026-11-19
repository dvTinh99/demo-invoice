const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
const UNITS = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];

function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];
  if (full || h > 0) parts.push(`${DIGITS[h]} trăm`);
  if (t > 1) {
    parts.push(`${DIGITS[t]} mươi`);
    if (u === 1) parts.push("mốt");
    else if (u === 4) parts.push("tư");
    else if (u === 5) parts.push("lăm");
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (t === 1) {
    parts.push("mười");
    if (u === 5) parts.push("lăm");
    else if (u > 0) parts.push(DIGITS[u]);
  } else if (u > 0) {
    if (full || h > 0) parts.push("lẻ");
    parts.push(DIGITS[u]);
  }
  return parts.join(" ");
}

/** Đọc số tiền VND thành chữ, ví dụ 1250000 => "Một triệu hai trăm năm mươi nghìn đồng". */
export function vndToWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Không đồng";
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    words.push(readTriple(groups[i], i < groups.length - 1) + UNITS[i]);
  }
  const s = words.join(" ").trim() + " đồng";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
