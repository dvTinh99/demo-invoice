"use client";

import Link from "next/link";
import { fmtTime, type ApiLogRow } from "@/lib/client-api";
import { JsonBlock } from "./JsonBlock";

const KIND_CLS: Record<string, string> = {
  AUTH: "bg-purple-100 text-purple-800",
  CREATE: "bg-blue-100 text-blue-800",
  SEARCH: "bg-cyan-100 text-cyan-800",
  FILE: "bg-slate-200 text-slate-800",
  EVENT: "bg-slate-100 text-slate-600",
};

function statusCls(log: ApiLogRow) {
  if (log.error) return "text-red-600";
  if (!log.status) return "text-slate-400";
  if (log.status >= 500) return "text-red-600";
  if (log.status >= 400) return "text-amber-600";
  return "text-emerald-600";
}

export function LogList({ logs, showInvoice = false }: { logs: ApiLogRow[]; showInvoice?: boolean }) {
  if (logs.length === 0) return <p className="text-sm text-slate-500">Chưa có log.</p>;
  return (
    <ol className="space-y-2">
      {logs.map((l) => (
        <li key={l.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-slate-400">{fmtTime(l.createdAt)}</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_CLS[l.kind] ?? ""}`}>{l.kind}</span>
            {l.method && <span className="font-mono text-slate-500">{l.method}</span>}
            {l.url && <span className="font-mono text-slate-700 break-all">{new URL(l.url).pathname}</span>}
            {(l.status || l.error) && (
              <span className={`font-mono font-semibold ${statusCls(l)}`}>{l.status ?? "ERR"}</span>
            )}
            {l.durationMs != null && <span className="font-mono text-slate-400">{l.durationMs}ms</span>}
            {showInvoice && l.invoiceId && (
              <Link href={`/invoices/${l.invoiceId}`} className="text-blue-600 hover:underline">
                {l.invoice?.orderRef ?? l.invoiceId}
              </Link>
            )}
          </div>
          {l.note && <p className={`mt-1 text-sm ${l.kind === "EVENT" ? "text-slate-800" : "text-slate-500"}`}>{l.note}</p>}
          {l.error && <p className="mt-1 text-sm text-red-600">{l.error}</p>}
          <JsonBlock label="Request" text={l.requestBody} />
          <JsonBlock label="Response" text={l.responseBody} />
        </li>
      ))}
    </ol>
  );
}
