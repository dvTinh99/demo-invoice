export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

export function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
      <dd className="min-w-0">{v}</dd>
    </div>
  );
}

export function Btn({
  children,
  primary,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${
        primary ? "bg-slate-900 text-white hover:bg-slate-700" : "border border-slate-300 bg-white hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
