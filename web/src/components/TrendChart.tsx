import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { TrendPoint } from "../../../shared/types.ts";
import { pct, record, winRate } from "../format.ts";
import { Card, TipBody, recordTip, useShowTip } from "./ui.tsx";

const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };
// Periods with fewer games get a hollow dot and don't set the scale.
const LOW_SAMPLE = 5;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Win rate per week or month, as a line against a 50% baseline. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [ref, width] = useWidth();
  const show = useShowTip();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const played = points.filter((p) => p.games > 0);
  const solid = played.filter((p) => p.games >= LOW_SAMPLE);
  const extent = Math.max(0.1, Math.ceil(Math.max(...solid.map((p) => Math.abs(winRate(p) - 0.5)), 0) * 10) / 10);
  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = plotW / Math.max(points.length, 1);
  const x = (i: number) => PAD.left + (i + 0.5) * step;
  const clamp = (v: number) => Math.min(0.5 + extent, Math.max(0.5 - extent, v));
  const y = (v: number) => PAD.top + ((0.5 + extent - clamp(v)) / (2 * extent)) * plotH;
  const ticks = [0.5 + extent, 0.5 + extent / 2, 0.5, 0.5 - extent / 2, 0.5 - extent];
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(plotW / 64, 1)));

  // Break the line at periods without games instead of drawing across them.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.games === 0) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(winRate(p)).toFixed(1)}`;
  });
  if (current) segments.push(current);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.min(points.length - 1, Math.max(0, Math.floor((e.clientX - rect.left) / step)));
    setHover(i);
    const p = points[i];
    show(
      p.games ? (
        <TipBody value={pct(winRate(p))} title={p.label} rows={[["Games", recordTip(p)]]} />
      ) : (
        <TipBody value="No games" title={p.label} />
      ),
      e.clientX,
      e.clientY,
    );
  }

  return (
    <Card
      title="Win rate over time"
      subtitle={`Per month, or per week for 90 days or less · gaps are periods without games · hollow dots have fewer than ${LOW_SAMPLE} games`}
      actions={
        <button type="button" className="btn small" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      }
    >
      {played.length === 0 ? (
        <div className="empty-inline">No games in this view.</div>
      ) : asTable ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Games</th>
                <th className="num">Win rate</th>
                <th className="num">Record</th>
              </tr>
            </thead>
            <tbody>
              {played.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="num">{p.games}</td>
                  <td className="num">{pct(winRate(p))}</td>
                  <td className="num secondary">{record(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref}>
          <svg width={width} height={HEIGHT} role="img" aria-label="Win rate over time" style={{ display: "block" }}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0.5 ? "var(--axis)" : "var(--grid)"}
                  strokeWidth="1"
                />
                <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="axis-label">
                  {pct(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={p.key} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="axis-label">
                  {p.label}
                </text>
              ) : null,
            )}
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--axis)" strokeWidth="1" />
            )}
            {segments.map((d) => (
              <path key={d} d={d} fill="none" stroke="var(--pos)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {points.map((p, i) =>
              p.games ? (
                <circle
                  key={p.key}
                  cx={x(i)}
                  cy={y(winRate(p))}
                  r={hover === i ? 5 : 4}
                  fill={p.games < LOW_SAMPLE ? "var(--surface)" : "var(--pos)"}
                  stroke={p.games < LOW_SAMPLE ? "var(--pos)" : "var(--surface)"}
                  strokeWidth="2"
                />
              ) : null,
            )}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => {
                setHover(null);
                show(null);
              }}
            />
          </svg>
        </div>
      )}
    </Card>
  );
}
