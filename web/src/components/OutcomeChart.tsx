import type { BucketStat } from "../../../shared/types.ts";
import { pct, winRate } from "../format.ts";
import { TipBody, recordTip, useTip } from "./ui.tsx";

const HEIGHT = 160;
const HALF = HEIGHT / 2;
const HEADROOM = 22; // room for the value label at the column cap
// Buckets with fewer games are drawn faded and don't set the scale, so one 3-game bucket
// can't flatten the rest of the chart.
const LOW_SAMPLE = 5;

/** Columns grow up (blue) or down (red) from a 50% baseline. */
export function OutcomeChart({ title, data }: { title: string; data: BucketStat[] }) {
  const tip = useTip();
  const played = data.filter((d) => d.games >= LOW_SAMPLE);
  const maxDev = Math.max(0.1, ...played.map((d) => Math.abs(winRate(d) - 0.5)));
  const compact = data.length > 5;
  const extent = Math.ceil(maxDev * 10) / 10; // round the axis to whole 10% steps
  const ticks = [0.5 + extent, 0.5, 0.5 - extent];
  const clamp = (v: number) => Math.min(0.5 + extent, Math.max(0.5 - extent, v));
  const y = (v: number) => HALF - ((clamp(v) - 0.5) / extent) * (HALF - HEADROOM);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="filter-label" style={{ marginBottom: 10 }}>
        {title}
        {compact && <span className="muted"> · games under each bar</span>}
      </figcaption>
      <div className="colchart">
        <div className="colchart-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: y(t) }}>
              {pct(t)}
            </span>
          ))}
        </div>
        <div className="colchart-plot">
          {ticks.map((t) => (
            <span key={t} className={`colchart-grid${t === 0.5 ? " base" : ""}`} style={{ top: y(t) }} />
          ))}
          {data.map((d) => {
            const v = winRate(d);
            const up = v >= 0.5;
            const h = Math.abs(y(v) - HALF);
            return (
              <div
                key={d.key}
                className="colchart-slot"
                aria-label={d.games ? `${d.label}: ${pct(v)} over ${d.games} games` : `${d.label}: no games`}
                {...tip(() =>
                  d.games ? (
                    <TipBody value={pct(v)} title={d.label} rows={[["Games", recordTip(d)]]} />
                  ) : (
                    <TipBody value="No games" title={d.label} />
                  ),
                )}
              >
                {d.games > 0 && (
                  <>
                    <span
                      className={`colchart-col ${up ? "pos" : "neg"}${d.games < LOW_SAMPLE ? " low" : ""}`}
                      style={up ? { bottom: HALF, height: Math.max(h, 2) } : { top: HALF, height: Math.max(h, 2) }}
                    />
                    <span
                      className="colchart-label tabular"
                      style={up ? { bottom: HALF + h + 4 } : { top: HALF + h + 4 }}
                    >
                      {pct(v)}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="colchart-x">
          {data.map((d) => (
            <div key={d.key}>
              {d.label}
              <span className="tabular">{compact ? d.games : `${d.games} games`}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
