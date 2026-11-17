interface MetricTileProps {
  label: string;
  value: string;
  unit?: string;
  subtext?: string;
  accent?: 'green' | 'amber' | 'red' | 'neutral';
}

export function MetricTile({
  label,
  value,
  unit,
  subtext,
  accent = 'neutral',
}: MetricTileProps) {
  const valueColor =
    accent === 'green'
      ? 'text-[#4ade80]'
      : accent === 'amber'
        ? 'text-[#fbbf24]'
        : accent === 'red'
          ? 'text-[#f87171]'
          : 'text-[#e5efe8]';

  return (
    <div className="panel-border rounded-sm px-3 py-2 flex flex-col justify-between">
      <div className="text-[10px] uppercase tracking-wider text-[#6e8a78]">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-base font-bold tabular-nums ${valueColor}`}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-[#6e8a78]">{unit}</span>}
      </div>
      {subtext && (
        <div className="mt-0.5 text-[10px] text-[#5e7a68] truncate">{subtext}</div>
      )}
    </div>
  );
}
