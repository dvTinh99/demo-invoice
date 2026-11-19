"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client-api";

/** GET `url` ngay khi mount rồi lặp lại mỗi `intervalMs` (0 = không lặp). */
export function usePolling<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await api<T>(url);
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    if (!intervalMs) return () => void (alive = false);
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, intervalMs]);

  return { data, error, reload };
}
