import type { Insight } from "../../../shared/types.ts";
import { Card, HeroImg, PlayerChip } from "./ui.tsx";

const PER_SIDE = 8;

function StatusIcon({ kind }: { kind: Insight["kind"] }) {
  return kind === "good" ? (
    <svg className="insight-icon good" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" />
      <path d="M4.5 8.2 7 10.6l4.6-5" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="insight-icon bad" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" />
      <path d="m5.2 5.2 5.6 5.6m0-5.6-5.6 5.6" fill="none" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Item({ insight }: { insight: Insight }) {
  return (
    <li className="insight">
      <StatusIcon kind={insight.kind} />
      <div className="insight-body">
        <div className="insight-title">
          {insight.title}
          <span className={`tag${insight.confidence === "strong" ? " strong" : ""}`}>
            {insight.confidence === "strong" ? "Strong" : "Possible"}
          </span>
        </div>
        <div className="insight-detail">{insight.detail}</div>
        {(insight.heroes.length > 0 || insight.players.length > 1) && (
          <div className="insight-subjects">
            {insight.heroes.map((h) => (
              <HeroImg key={h} id={h} size="md" />
            ))}
            {insight.players.length > 1 && insight.players.map((p) => <PlayerChip key={p} accountId={p} />)}
          </div>
        )}
      </div>
      <span className="insight-category">{insight.category}</span>
    </li>
  );
}

export function Insights({ insights }: { insights: Insight[] }) {
  const good = insights.filter((i) => i.kind === "good").slice(0, PER_SIDE);
  const bad = insights.filter((i) => i.kind === "bad").slice(0, PER_SIDE);

  return (
    <Card
      title="Key insights"
      subtitle="Patterns where a group of games wins clearly more or less than the rest. Strong findings survive a check for testing many patterns at once; possible ones could still be chance."
    >
      {insights.length === 0 ? (
        <div className="empty-inline">No clear patterns in these games yet. More games or wider filters will help.</div>
      ) : (
        <div className="split">
          <div>
            <h3 className="insight-heading">
              <StatusIcon kind="good" /> Working
            </h3>
            {good.length ? (
              <ul className="insight-list">
                {good.map((i) => (
                  <Item key={i.id} insight={i} />
                ))}
              </ul>
            ) : (
              <div className="empty-inline">Nothing stands out yet.</div>
            )}
          </div>
          <div>
            <h3 className="insight-heading">
              <StatusIcon kind="bad" /> Not working
            </h3>
            {bad.length ? (
              <ul className="insight-list">
                {bad.map((i) => (
                  <Item key={i.id} insight={i} />
                ))}
              </ul>
            ) : (
              <div className="empty-inline">Nothing stands out yet.</div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
