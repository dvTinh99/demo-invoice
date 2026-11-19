"use client";

import { useEffect, useState } from "react";
import { api, type StatusInfo } from "@/lib/client-api";

export function ModeBadge() {
  const [s, setS] = useState<StatusInfo | null>(null);
  useEffect(() => {
    api<StatusInfo>("/api/status").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  return s.mockMode ? (
    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800" title={s.baseUrl}>
      MOCK MODE
    </span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800" title={s.baseUrl}>
      VIETTEL · {new URL(s.baseUrl).host}
    </span>
  );
}
