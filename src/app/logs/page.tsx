"use client";

import { useState } from "react";
import { LogList } from "@/components/LogList";
import type { ApiLogRow } from "@/lib/client-api";
import { usePolling } from "@/lib/use-polling";

const KINDS = ["", "AUTH", "CREATE", "SEARCH", "FILE", "EVENT"];

export default function LogsPage() {
  const [kind, setKind] = useState("");
  const [auto, setAuto] = useState(true);
  const { data } = usePolling<{ logs: ApiLogRow[] }>(`/api/logs?limit=200${kind ? `&kind=${kind}` : ""}`, auto ? 3000 : 0);
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Log kỹ thuật</h1>
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k || "all"}
              onClick={() => setKind(k)}
              className={`rounded px-2 py-1 text-xs ${kind === k ? "bg-slate-900 text-white" : "bg-white border border-slate-300"}`}
            >
              {k || "Tất cả"}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Tự làm mới
        </label>
      </div>
      <p className="text-xs text-slate-500">Mật khẩu và access token được che trước khi ghi log.</p>
      <LogList logs={logs} showInvoice />
    </div>
  );
}
