"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Btn, Card } from "@/components/ui";
import { api, fmtVnd, type StatusInfo } from "@/lib/client-api";
import { PAYMENT_METHODS, TAX_RATES } from "@/lib/invoice/constants";

interface Item {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  taxPercentage: number;
}

const newOrderRef = () => `DH-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;

interface SendResult {
  httpStatus: number;
  replayed: boolean;
  durationMs: number;
  body: { invoice?: { id: string; status: string; invoiceNo: string | null; errorCode: string | null; errorMessage: string | null }; message?: string; error?: string };
}

export default function NewInvoicePage() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [buyer, setBuyer] = useState({
    name: "Nguyễn Văn An",
    legalName: "Công ty TNHH Thương mại An Phát",
    taxCode: "0312770607",
    address: "12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh",
    email: "ketoan@anphat.vn",
    phone: "0901234567",
    notGetInvoice: false,
  });
  const [paymentMethod, setPaymentMethod] = useState("3"); // TM/CK
  const [paymentMethodName, setPaymentMethodName] = useState("");
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[]>([
    { name: "Laptop Dell Latitude 5440", unit: "Chiếc", quantity: 2, unitPrice: 18500000, taxPercentage: 10 },
    { name: "Chuột không dây Logitech M331", unit: "Chiếc", quantity: 5, unitPrice: 350000, taxPercentage: 8 },
  ]);
  const [scenario, setScenario] = useState("success");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Sinh ở client sau khi mount (tránh lệch hydration): 1 phiên form = 1 Idempotency-Key
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdemKey(crypto.randomUUID());
    setOrderRef(newOrderRef());
    api<StatusInfo>("/api/status").then(setStatus).catch(() => {});
  }, []);

  const totals = useMemo(() => {
    let net = 0;
    let tax = 0;
    for (const it of items) {
      const a = Math.round(it.quantity * it.unitPrice);
      net += a;
      tax += it.taxPercentage > 0 ? Math.round((a * it.taxPercentage) / 100) : 0;
    }
    return { net, tax, total: net + tax };
  }, [items]);

  const input = { orderRef, buyer, paymentMethod, paymentMethodName, paid, note, items };

  async function sendOnce(): Promise<SendResult> {
    const started = performance.now();
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
      body: JSON.stringify({ input, mockScenario: status?.mockMode ? scenario : undefined }),
    });
    const body = await res.json().catch(() => ({}));
    return {
      httpStatus: res.status,
      replayed: res.headers.get("Idempotent-Replayed") === "true",
      durationMs: Math.round(performance.now() - started),
      body,
    };
  }

  async function submit(parallel = 1) {
    setSending(true);
    setError(null);
    try {
      const r = await Promise.all(Array.from({ length: parallel }, sendOnce));
      setResults((prev) => [...r, ...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function resetForm() {
    setIdemKey(crypto.randomUUID());
    setOrderRef(newOrderRef());
    setResults([]);
    setError(null);
  }

  const updateItem = (i: number, patch: Partial<Item>) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const latestInvoiceId = results.find((r) => r.body.invoice)?.body.invoice?.id;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <h1 className="text-xl font-semibold">Tạo hóa đơn</h1>

        <Card title="Thông tin đơn hàng & người mua">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mã đơn hàng (orderRef)" value={orderRef} onChange={setOrderRef} />
            <label className="block">
              <span className="text-xs text-slate-500">Hình thức thanh toán (paymentMethod)</span>
              <select
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                {PAYMENT_METHODS.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
              </select>
            </label>
            {paymentMethod === "5" && (
              <Field label="Tên hình thức khác (free text)" value={paymentMethodName} onChange={setPaymentMethodName} />
            )}
            <Field label="Tên người mua (cá nhân)" value={buyer.name} onChange={(v) => setBuyer({ ...buyer, name: v })} />
            <Field label="Tên đơn vị (bắt buộc nếu có MST)" value={buyer.legalName} onChange={(v) => setBuyer({ ...buyer, legalName: v })} />
            <Field label="Mã số thuế người mua" value={buyer.taxCode} onChange={(v) => setBuyer({ ...buyer, taxCode: v })} />
            <Field label="Email (nhiều email cách nhau bởi ;)" value={buyer.email} onChange={(v) => setBuyer({ ...buyer, email: v })} />
            <Field label="Điện thoại" value={buyer.phone} onChange={(v) => setBuyer({ ...buyer, phone: v })} />
            <Field label={buyer.notGetInvoice ? "Địa chỉ" : "Địa chỉ *"} value={buyer.address} onChange={(v) => setBuyer({ ...buyer, address: v })} />
            <Field label="Ghi chú hóa đơn (invoiceNote)" value={note} onChange={setNote} />
          </div>
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Đã thanh toán (paymentStatus)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={buyer.notGetInvoice} onChange={(e) => setBuyer({ ...buyer, notGetInvoice: e.target.checked })} />
              Người mua không lấy hóa đơn (buyerNotGetInvoice = 1)
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Theo đặc tả: cần tên người mua hoặc tên đơn vị, và địa chỉ, khi người mua có lấy hóa đơn. Có MST thì bắt buộc tên đơn vị.
          </p>
        </Card>

        <Card title="Hàng hóa / dịch vụ">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Tên hàng</th>
                  <th className="py-1 pr-2 w-24">ĐVT</th>
                  <th className="py-1 pr-2 w-20">SL</th>
                  <th className="py-1 pr-2 w-32">Đơn giá</th>
                  <th className="py-1 pr-2 w-32">Thuế suất</th>
                  <th className="py-1 pr-2 w-32 text-right">Thành tiền</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2 min-w-48"><Input value={it.name} onChange={(v) => updateItem(i, { name: v })} /></td>
                    <td className="py-1 pr-2"><Input value={it.unit} onChange={(v) => updateItem(i, { unit: v })} /></td>
                    <td className="py-1 pr-2"><Input type="number" value={String(it.quantity)} onChange={(v) => updateItem(i, { quantity: Number(v) })} /></td>
                    <td className="py-1 pr-2"><Input type="number" value={String(it.unitPrice)} onChange={(v) => updateItem(i, { unitPrice: Number(v) })} /></td>
                    <td className="py-1 pr-2">
                      <select
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                        value={it.taxPercentage}
                        onChange={(e) => updateItem(i, { taxPercentage: Number(e.target.value) })}
                      >
                        {TAX_RATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{fmtVnd(Math.round(it.quantity * it.unitPrice))}</td>
                    <td>
                      <button className="text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, idx) => idx !== i))} title="Xóa dòng">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="mt-2 text-sm text-blue-600 hover:underline"
            onClick={() => setItems([...items, { name: "", unit: "Cái", quantity: 1, unitPrice: 0, taxPercentage: 10 }])}
          >
            + Thêm dòng
          </button>
          <dl className="mt-4 ml-auto w-72 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Cộng tiền hàng</dt><dd className="font-mono">{fmtVnd(totals.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tiền thuế GTGT</dt><dd className="font-mono">{fmtVnd(totals.tax)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Tổng thanh toán</dt><dd className="font-mono">{fmtVnd(totals.total)}</dd></div>
          </dl>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title="Gửi yêu cầu xuất hóa đơn">
          <label className="block text-xs text-slate-500">Idempotency-Key (1 key / 1 lần lập hóa đơn)</label>
          <div className="mt-1 break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{idemKey || "…"}</div>

          {status?.mockMode && (
            <div className="mt-4">
              <label className="block text-xs text-slate-500">Kịch bản Mock</label>
              <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {Object.entries(status.scenarios).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <Btn primary disabled={sending || !idemKey} onClick={() => submit(1)}>
              {sending ? "Đang gửi…" : "Xuất hóa đơn"}
            </Btn>
            <Btn disabled={sending || !idemKey} onClick={() => submit(3)} title="Bắn 3 request đồng thời cùng Idempotency-Key">
              Test double-submit (3 request song song)
            </Btn>
            <Btn disabled={sending} onClick={resetForm}>Hóa đơn mới (key mới)</Btn>
          </div>
          {sending && scenario.startsWith("timeout") && (
            <p className="mt-2 text-xs text-amber-700">Đang chờ timeout ({(status?.timeoutMs ?? 0) / 1000}s) rồi tự đối soát…</p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Bấm “Xuất hóa đơn” nhiều lần với cùng key: chỉ lần đầu gọi Viettel, các lần sau trả lại kết quả cũ (HTTP 200 + Idempotent-Replayed).
            Sửa nội dung rồi gửi cùng key → 422.
          </p>
        </Card>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        {results.length > 0 && (
          <Card title="Kết quả">
            <ol className="space-y-2">
              {results.map((r, i) => (
                <li key={i} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-mono font-semibold ${r.httpStatus < 300 ? "text-emerald-700" : r.httpStatus < 500 ? "text-amber-700" : "text-red-700"}`}>
                      HTTP {r.httpStatus}
                    </span>
                    {r.replayed && <span className="rounded bg-slate-200 px-1.5 text-xs">replayed</span>}
                    <span className="font-mono text-xs text-slate-400">{r.durationMs}ms</span>
                    {r.body.invoice && <StatusBadge status={r.body.invoice.status} />}
                  </div>
                  {r.body.invoice?.invoiceNo && <div className="mt-1 font-mono">Số HĐ: {r.body.invoice.invoiceNo}</div>}
                  {r.body.invoice?.errorMessage && <div className="mt-1 text-xs text-slate-600">{r.body.invoice.errorMessage}</div>}
                  {!r.body.invoice && <div className="mt-1 text-xs text-slate-600">[{r.body.error}] {r.body.message}</div>}
                </li>
              ))}
            </ol>
            {latestInvoiceId && (
              <Link href={`/invoices/${latestInvoiceId}`} className="mt-3 inline-block text-sm text-blue-600 hover:underline">
                Xem chi tiết & log kỹ thuật →
              </Link>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

function Input({ value, onChange, type = "text" }: { value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
    />
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <Input value={value} onChange={onChange} />
    </label>
  );
}
