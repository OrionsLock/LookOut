import { useId } from "react";

type Props = {
  data: number[];
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
};

export function Sparkline({
  data,
  height = 64,
  stroke = "#a5b4fc",
  fill = "rgba(99, 102, 241, 0.25)",
  ariaLabel,
}: Props) {
  const id = useId();
  const gradId = `spark-grad-${id}`;
  const w = 100;
  const h = 100;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - ((v - min) / span) * h * 0.85 - 6;
    return [x, y] as const;
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="sparkline"
      role="img"
      aria-label={ariaLabel ?? "trend"}
      style={{ height }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
