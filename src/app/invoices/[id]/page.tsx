"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { JsonBlock } from "@/components/JsonBlock";
import { LogList } from "@/components/LogList";
import { StatusBadge } from "@/components/StatusBadge";
import { Btn, Card, Row } from "@/components/ui";
import { api, fmtTime, fmtVnd, type ApiLogRow, type InvoiceRow } from "@/lib/client-api";
import { usePolling } from "@/lib/use-polling";

type Detail = InvoiceRow & {
  reservationCode: string | null;
  viettelTxnId: string | null;
  codeOfTax: string | null;
  lastSentAt: string | null;
  payload: string;
  input: string;
  requestHash: string;
  logs: ApiLogRow[];
};

const HINT: Record<string, string> = {
  UNKNOWN: "Không chắc Viettel đã lập hóa đơn hay chưa. Hệ thống sẽ tra cứu theo transactionUuid trước; chỉ gửi lại khi xác nhận Viettel chưa có hóa đơn và đã qua tối thiểu 90s kể từ lần gửi trước (quy tắc kiểm trùng của Viettel).",
  AWAITING_NUMBER: "Viettel đã nhận hóa đơn nhưng chưa trả số (xử lý bất đồng bộ). Không được gửi lại — chỉ đối soát để lấy số.",
  FAILED: "Viettel đã từ chối → chắc chắn chưa có hóa đơn. Có thể gửi lại (cùng transactionUuid).",
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = usePolling<{ invoice: Detail }>(`/api/invoices/${id}`, 3000);
  const inv = data?.invoice ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function action(path: "reconcile" | "retry") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ invoice: Detail }>(`/api/invoices/${id}/${path}`, { method: "POST" });
      setMsg({ ok: true, text: `${path === "retry" ? "Gửi lại" : "Đối soát"} xong → ${r.invoice.status}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      reload();
    }
  }

  if (!inv) return <p className="text-sm text-slate-500">{error ?? "Đang tải…"}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">← Danh sách</Link>
        <h1 className="text-xl font-semibold">{inv.orderRef}</h1>
        <StatusBadge status={inv.status} />
        <div className="ml-auto flex gap-2">
          {inv.status !== "ISSUED" && inv.status !== "PROCESSING" && (
            <Btn disabled={busy} onClick={() => action("reconcile")}>Đối soát</Btn>
          )}
          {(inv.status === "FAILED" || inv.status === "UNKNOWN") && (
            <Btn primary disabled={busy} onClick={() => action("retry")}>Gửi lại</Btn>
          )}
          {inv.invoiceNo && (
            <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
              Xem PDF
            </a>
          )}
          {inv.invoiceNo && (
            <a href={`/api/invoices/${inv.id}/pdf?type=ZIP`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              Tải ZIP
            </a>
          )}
        </div>
      </div>

      {HINT[inv.status] && <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">{HINT[inv.status]}</div>}
      {msg && <div className={`rounded-md px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</div>}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card title="Hóa đơn">
            <dl className="space-y-1 text-sm">
              <Row k="Số hóa đơn" v={<span className="font-mono">{inv.invoiceNo ?? "—"}</span>} />
              <Row k="Mã tra cứu" v={<span className="font-mono">{inv.reservationCode ?? "—"}</span>} />
              <Row k="Viettel TxnID" v={<span className="font-mono text-xs">{inv.viettelTxnId ?? "—"}</span>} />
              {inv.codeOfTax && <Row k="Mã CQT" v={<span className="font-mono text-xs">{inv.codeOfTax}</span>} />}
              <Row k="Người mua" v={inv.buyerName} />
              <Row k="Tổng tiền" v={<span className="font-mono">{fmtVnd(inv.totalAmount)}</span>} />
              <Row k="Lần gửi" v={inv.attempts} />
              <Row k="Tạo lúc" v={fmtTime(inv.createdAt)} />
              <Row k="Gửi lần cuối" v={fmtTime(inv.lastSentAt)} />
              <Row k="Phát hành" v={fmtTime(inv.issuedAt)} />
              {inv.errorCode && <Row k="Mã lỗi" v={<span className="font-mono text-xs text-red-700">{inv.errorCode}</span>} />}
              {inv.errorMessage && <Row k="Mô tả" v={<span className="text-xs">{inv.errorMessage}</span>} />}
            </dl>
          </Card>
          <Card title="Khóa chống trùng">
            <dl className="space-y-1 text-sm">
              <Row k="Idempotency" v={<span className="font-mono text-xs break-all">{inv.idempotencyKey}</span>} />
              <Row k="transactionUuid" v={<span className="font-mono text-xs break-all">{inv.transactionUuid}</span>} />
              <Row k="Request hash" v={<span className="font-mono text-xs break-all">{inv.requestHash.slice(0, 16)}…</span>} />
              {inv.mockScenario && <Row k="Kịch bản" v={inv.mockScenario} />}
            </dl>
            <JsonBlock label="Payload createInvoice" text={inv.payload} />
          </Card>
        </div>

        <Card title={`Timeline kỹ thuật (${inv.logs.length})`}>
          <LogList logs={inv.logs} />
        </Card>
      </div>
    </div>
  );
}
