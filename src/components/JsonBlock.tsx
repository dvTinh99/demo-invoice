"use client";

import { useState } from "react";

function pretty(text: string | null | undefined): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // form-urlencoded hoặc text thường
    if (/^[\w%.-]+=/.test(text) && text.includes("=")) {
      return [...new URLSearchParams(text).entries()].map(([k, v]) => `${k}=${v}`).join("\n");
    }
    return text;
  }
}

export function JsonBlock({ label, text, defaultOpen = false }: { label: string; text: string | null | undefined; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text) return null;
  return (
    <div className="mt-1">
      <button onClick={() => setOpen(!open)} className="text-xs text-slate-500 hover:text-slate-800">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-96 overflow-auto rounded bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
          {pretty(text)}
        </pre>
      )}
    </div>
  );
}
