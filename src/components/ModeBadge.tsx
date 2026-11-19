"use client";

import { useEffect, useState } from "react";
import { api, type StatusInfo } from "@/lib/client-api";

/** Chọn nhà cung cấp hóa đơn (lưu cookie, server đọc ở /api/status và lúc tạo hóa đơn) + badge chế độ. */
export function ModeBadge() {
  const [s, setS] = useState<StatusInfo | null>(null);
  useEffect(() => {
    api<StatusInfo>("/api/status").then(setS).catch(() => {});
  }, []);
  if (!s) return null;

  const switchTo = (p: string) => {
    document.cookie = `invoice_provider=${p}; path=/; max-age=31536000; samesite=lax`;
    location.reload(); // mọi trang đều đọc lại /api/status theo provider mới
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="provider" className="text-xs text-slate-500">Nhà cung cấp</label>
      <select
        id="provider"
        value={s.provider}
        onChange={(e) => switchTo(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        {Object.entries(s.providers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${s.mockMode ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
        title={s.baseUrl}
      >
        {s.mockMode ? "MOCK MODE" : new URL(s.baseUrl).host}
      </span>
    </div>
  );
}
