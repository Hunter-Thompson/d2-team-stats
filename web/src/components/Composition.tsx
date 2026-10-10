import type { CompositionFactor } from "../../../shared/types.ts";
import { OutcomeChart } from "./OutcomeChart.tsx";
import { Card } from "./ui.tsx";

const SHOWN = 4;

export function Composition({ composition }: { composition: CompositionFactor[] }) {
  const top = composition.filter((f) => f.spread > 0).slice(0, SHOWN);
  return (
    <Card
      title="Draft composition"
      subtitle="Win rate by how many of our 5 heroes fill a role, using Valve's hero role ratings · the factors with the biggest gaps are shown"
    >
      {top.length === 0 ? (
        <div className="empty-inline">Not enough games to compare drafts yet.</div>
      ) : (
        <div className="chart-grid">
          {top.map((f) => (
            <OutcomeChart key={f.key} title={`${f.label} in our draft`} data={f.buckets} />
          ))}
        </div>
      )}
    </Card>
  );
}
