"use client";

import Link from "next/link";
import { useState } from "react";
import { STYLES, StatusBadge } from "@/components/StatusBadge";
import { Btn, Card, Row } from "@/components/ui";
import { api, fmtTime, fmtVnd, type InvoiceRow, type StatusInfo } from "@/lib/client-api";
import { usePolling } from "@/lib/use-polling";

export default function Dashboard() {
  const st = usePolling<StatusInfo>("/api/status", 4000);
  const [filter, setFilter] = useState({ q: "", status: "", provider: "" });
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v.trim())).toString();
  const list = usePolling<{ invoices: InvoiceRow[] }>(`/api/invoices${qs ? `?${qs}` : ""}`, 4000);
  const setF = (k: keyof typeof filter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const status = st.data;
  const invoices = list.data?.invoices ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => Promise.all([st.reload(), list.reload()]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      load();
    }
  }

  const tokenAction = (action: string, label: string) =>
    run(label, async () => {
      await api("/api/token", { method: "POST", body: JSON.stringify({ action }) });
      return `${label}: OK`;
    });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Cấu hình">
          {status && (
            <dl className="space-y-1 text-sm">
              <Row k="Nhà cung cấp" v={status.providers[status.provider]} />
              <Row k="Chế độ" v={status.provider === "sepay" ? "API SePay (sandbox/production theo Base URL)" : status.provider === "matbao" ? "API Mắt Bão (demo/production theo Base URL)" : status.mockMode ? "Mock (không cần tài khoản Viettel)" : "Viettel thật"} />
              <Row k="Base URL" v={<span className="font-mono text-xs break-all">{status.baseUrl}</span>} />
              <Row k="MST người bán" v={status.supplierTaxCode} />
              <Row k="Loại / Mẫu / KH" v={`${status.invoiceType} · ${status.templateCode} · ${status.invoiceSeries}`} />
              <Row k="Timeout" v={`${status.timeoutMs / 1000}s` + (status.minResendGapMs ? ` (gửi lại sau ≥ ${status.minResendGapMs / 1000}s)` : " (SePay tự chặn trùng reference_code)")} />
            </dl>
          )}
          {status && status.configErrors.length > 0 && (
            <ul className="mt-3 list-disc rounded bg-red-50 py-2 pl-6 pr-2 text-xs text-red-800">
              {status.configErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </Card>

        <Card title="Access token">
          {status?.token ? (
            <dl className="space-y-1 text-sm">
              <Row k="Token" v={<span className="font-mono text-xs">{status.token.tokenPreview}</span>} />
              <Row k="Hết hạn" v={fmtTime(status.token.expiresAt)} />
              <Row
                k="Trạng thái"
                v={status.token.fresh ? <span className="text-emerald-700">Còn hạn</span> : <span className="text-amber-700">Sẽ refresh ở lần gọi sau</span>}
              />
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Chưa đăng nhập — token sẽ được lấy tự động ở request đầu tiên.</p>
          )}
          {status?.provider === "viettel" && <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => tokenAction("refresh", "Refresh token")} disabled={!!busy}>Refresh</Btn>
            <Btn onClick={() => tokenAction("expire-local", "Làm token local hết hạn")} disabled={!!busy}>Hết hạn local</Btn>
            {status?.mockMode && (
              <Btn onClick={() => tokenAction("revoke-server", "Thu hồi token phía server")} disabled={!!busy}>
                Thu hồi phía server (→ 401)
              </Btn>
            )}
          </div>}
        </Card>

        <Card title="Thống kê & Đối soát">
          <div className="flex flex-wrap gap-2 text-sm">
            {["ISSUED", "AWAITING_NUMBER", "UNKNOWN", "FAILED", "PROCESSING"].map((s) => (
              <div key={s} className="flex items-center gap-1">
                <StatusBadge status={s} />
                <span className="font-semibold">{status?.counts[s] ?? 0}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn
              primary
              disabled={!!busy}
              onClick={() =>
                run("Đối soát", async () => {
                  const r = await api<{ results: { orderRef: string; before: string; after: string }[] }>("/api/reconcile", { method: "POST" });
                  if (r.results.length === 0) return "Không có hóa đơn nào cần đối soát";
                  return "Đối soát: " + r.results.map((x) => `${x.orderRef} ${x.before}→${x.after}`).join(", ");
                })
              }
            >
              Chạy job đối soát
            </Btn>
            <Btn
              disabled={!!busy}
              onClick={() => {
                if (!confirm("Xóa toàn bộ dữ liệu demo (hóa đơn, log, token, dữ liệu mock)?")) return;
                run("Reset", async () => {
                  await api("/api/admin/reset", { method: "POST" });
                  return "Đã reset dữ liệu demo";
                });
              }}
            >
              Reset dữ liệu demo
            </Btn>
          </div>
        </Card>
      </section>

      {(st.error || list.error) && !msg && (
        <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{st.error || list.error}</div>
      )}
      {msg && (
        <div className={`rounded-md px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Hóa đơn</h2>
          <div className="ml-auto mr-3 flex flex-wrap items-center gap-2 text-sm">
            <input
              type="search"
              value={filter.q}
              onChange={setF("q")}
              placeholder="Mã đơn, người mua, số HĐ…"
              aria-label="Tìm hóa đơn"
              className="w-56 rounded-md border border-slate-300 px-2 py-1"
            />
            <select value={filter.status} onChange={setF("status")} aria-label="Lọc trạng thái" className="rounded-md border border-slate-300 bg-white px-2 py-1">
              <option value="">Mọi trạng thái</option>
              {Object.entries(STYLES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <select value={filter.provider} onChange={setF("provider")} aria-label="Lọc nhà cung cấp" className="rounded-md border border-slate-300 bg-white px-2 py-1">
              <option value="">Mọi nhà cung cấp</option>
              {Object.entries(status?.providers ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {qs && <button onClick={() => setFilter({ q: "", status: "", provider: "" })} className="text-slate-500 hover:text-slate-900">Xóa lọc</button>}
          </div>
          <Link href="/invoices/new" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            + Tạo hóa đơn
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Mã đơn</th>
                <th className="px-4 py-2">Nhà cung cấp</th>
                <th className="px-4 py-2">Người mua</th>
                <th className="px-4 py-2 text-right">Tổng tiền</th>
                <th className="px-4 py-2">Trạng thái</th>
                <th className="px-4 py-2">Số hóa đơn</th>
                <th className="px-4 py-2">Lần gửi</th>
                <th className="px-4 py-2">Kịch bản</th>
                <th className="px-4 py-2">Tạo lúc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    {qs ? "Không có hóa đơn khớp bộ lọc." : <>Chưa có hóa đơn. <Link href="/invoices/new" className="text-blue-600 hover:underline">Tạo hóa đơn đầu tiên</Link></>}
                  </td>
                </tr>
              )}
              {invoices.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/invoices/${i.id}`} className="font-medium text-blue-600 hover:underline">{i.orderRef}</Link>
                  </td>
                  <td className="px-4 py-2 text-xs">{status?.providers[i.provider as StatusInfo["provider"]] ?? i.provider}</td>
                  <td className="px-4 py-2">{i.buyerName}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtVnd(i.totalAmount)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={i.status} />
                    {i.errorCode && <div className="mt-0.5 text-xs text-slate-500">{i.errorCode}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono">{i.invoiceNo ?? "—"}</td>
                  <td className="px-4 py-2 text-center">{i.attempts}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{i.mockScenario ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{fmtTime(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
