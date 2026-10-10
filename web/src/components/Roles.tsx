import { POSITION_ACCURACY, POSITION_LABELS, type Member, type RoleStat, type WinLoss } from "../../../shared/types.ts";
import { pct, winRate } from "../format.ts";
import { Card, TipBody, heatStyle, playerStyle, recordTip, useTip } from "./ui.tsx";

const POSITIONS = [1, 2, 3, 4, 5];
const LOW_SAMPLE = 5;
const MAX_PLAYERS = 8;

export function mainRole(roles: RoleStat[], accountId: number) {
  const mine = roles.filter((r) => r.accountId === accountId);
  const total = mine.reduce((n, r) => n + r.games, 0);
  const top = mine.reduce<RoleStat | null>((best, r) => (!best || r.games > best.games ? r : best), null);
  return top && total ? { position: top.position, share: top.games / total } : null;
}

export function Roles({
  members,
  roles,
  onFocus,
}: {
  members: Member[];
  roles: RoleStat[];
  onFocus: (accountId: number, position: number) => void;
}) {
  const tip = useTip();
  const totals = new Map<number, number>();
  for (const r of roles) totals.set(r.accountId, (totals.get(r.accountId) ?? 0) + r.games);
  const played = members.filter((m) => totals.has(m.accountId));
  const rows = played.sort((a, b) => totals.get(b.accountId)! - totals.get(a.accountId)!).slice(0, MAX_PLAYERS);
  const cell = (accountId: number, position: number): WinLoss =>
    roles.find((r) => r.accountId === accountId && r.position === position) ?? { games: 0, wins: 0 };

  return (
    <Card
      title="Roles"
      subtitle={`Win rate by inferred position · click a cell to focus the dashboard on that player in that role${
        played.length > MAX_PLAYERS ? ` · top ${MAX_PLAYERS} players by games` : ""
      }`}
    >
      {rows.length === 0 ? (
        <div className="empty-inline">No games in this view.</div>
      ) : (
        <>
          <div className="matrix" style={{ gridTemplateColumns: `minmax(80px, 130px) repeat(5, minmax(48px, 1fr))` }}>
            <span />
            {POSITIONS.map((p) => (
              <div key={p} className="matrix-head col">
                <span className="name">{POSITION_LABELS[p]}</span>
              </div>
            ))}
            {rows.map((m) => (
              <div key={m.accountId} style={{ display: "contents" }}>
                <div className="matrix-head" style={playerStyle(m.colorSlot)}>
                  <span className="dot" />
                  <span className="name">{m.name}</span>
                </div>
                {POSITIONS.map((p) => {
                  const r = cell(m.accountId, p);
                  const label = `${m.name} on ${POSITION_LABELS[p]}`;
                  if (r.games === 0) {
                    return (
                      <div key={p} className="matrix-cell no-data" aria-label={`${label}: no games`}>
                        <span>0</span>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={p}
                      type="button"
                      className="matrix-cell"
                      style={heatStyle(r, LOW_SAMPLE)}
                      aria-label={`${label}: ${pct(winRate(r))} over ${r.games} games`}
                      onClick={() => onFocus(m.accountId, p)}
                      {...tip(() => (
                        <TipBody
                          value={pct(winRate(r))}
                          title={label}
                          rows={[
                            ["Games", recordTip(r)],
                            ["Share of their games", pct(r.games / totals.get(m.accountId)!)],
                          ]}
                        />
                      ))}
                    >
                      <strong>{pct(winRate(r))}</strong>
                      <span>{r.games}g</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="footnote">
            Positions are inferred from farm, how fast each player hit level 6 and each hero's usual role. Checked against
            replay data: {POSITIONS.slice(0, 3).map((p) => `${POSITION_LABELS[p].toLowerCase()} ${pct(POSITION_ACCURACY[p])}`).join(", ")}{" "}
            accurate; which support was in which lane is right {pct(POSITION_ACCURACY[4])} of the time. Grey cells have fewer
            than {LOW_SAMPLE} games.
          </p>
        </>
      )}
    </Card>
  );
}
