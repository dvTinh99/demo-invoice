export const STYLES: Record<string, { cls: string; label: string }> = {
  PROCESSING: { cls: "bg-blue-100 text-blue-800", label: "Đang xử lý" },
  ISSUED: { cls: "bg-emerald-100 text-emerald-800", label: "Đã phát hành" },
  AWAITING_NUMBER: { cls: "bg-violet-100 text-violet-800", label: "Chờ cấp số" },
  FAILED: { cls: "bg-red-100 text-red-800", label: "Thất bại" },
  UNKNOWN: { cls: "bg-amber-100 text-amber-800", label: "Chưa rõ (cần đối soát)" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { cls: "bg-slate-100 text-slate-700", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  );
}
