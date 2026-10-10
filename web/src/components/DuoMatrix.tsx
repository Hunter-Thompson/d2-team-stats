import { useState } from "react";
import type { DuoStat, Member, PlayerStat, WinLoss } from "../../../shared/types.ts";
import { pct, record, winRate } from "../format.ts";
import { Card, HEAT_FULL_AT, PlayerChip, TipBody, WinRate, heatStyle, playerStyle, recordTip, useTip } from "./ui.tsx";

const MAX_PLAYERS = 8;
// Below this many games a cell keeps the neutral fill, so one lucky game doesn't look like a trend.
const LOW_SAMPLE = 3;
const FULL_AT = HEAT_FULL_AT;
const cellStyle = (r: WinLoss) => heatStyle(r, LOW_SAMPLE);

export function DuoMatrix({
  members: allMembers,
  duos,
  players,
  min,
}: {
  members: Member[];
  duos: DuoStat[];
  players: PlayerStat[];
  min: number;
}) {
  const tip = useTip();
  // The grid shows the players with the most games in the current view.
  const games = new Map(players.map((p) => [p.accountId, p.games]));
  const members = allMembers
    .filter((m) => games.has(m.accountId))
    .sort((a, b) => games.get(b.accountId)! - games.get(a.accountId)!)
    .slice(0, MAX_PLAYERS);
  const [asTable, setAsTable] = useState(false);
  const pair = (a: number, b: number) => duos.find((d) => d.a === Math.min(a, b) && d.b === Math.max(a, b));
  const solo = (a: number) => players.find((p) => p.accountId === a);

  const toggle = (
    <button type="button" className="btn small" onClick={() => setAsTable((v) => !v)}>
      {asTable ? "Show grid" : "Show table"}
    </button>
  );

  if (members.length < 2) {
    return (
      <Card title="Duos" subtitle="Win rate when two players are in the same game">
        <div className="empty-inline">Duos need two players from the team in the same game.</div>
      </Card>
    );
  }

  return (
    <Card
      title="Duos"
      subtitle={`Win rate when both players are on the team · diagonal is each player's own win rate${
        players.length > MAX_PLAYERS ? ` · top ${MAX_PLAYERS} players by games` : ""
      }`}
      actions={toggle}
    >
      {asTable ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Players</th>
                <th className="num">Games</th>
                <th className="num">Win rate</th>
                <th className="num">Record</th>
              </tr>
            </thead>
            <tbody>
              {[...duos]
                .sort((x, y) => y.games - x.games)
                .map((d) => (
                  <tr key={`${d.a}-${d.b}`}>
                    <td>
                      <div style={{ display: "flex", gap: 12 }}>
                        <PlayerChip accountId={d.a} />
                        <PlayerChip accountId={d.b} />
                      </div>
                    </td>
                    <td className="num">{d.games}</td>
                    <td className="num">
                      <WinRate r={d} />
                    </td>
                    <td className="num secondary">{record(d)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            className="matrix"
            style={{ gridTemplateColumns: `minmax(80px, 130px) repeat(${members.length}, minmax(48px, 1fr))` }}
          >
            <span />
            {members.map((m) => (
              <div key={m.accountId} className="matrix-head col" style={playerStyle(m.colorSlot)}>
                <span className="dot" />
                <span className="name">{m.name}</span>
              </div>
            ))}
            {members.map((row) => (
              <div key={row.accountId} style={{ display: "contents" }}>
                <div className="matrix-head" style={playerStyle(row.colorSlot)}>
                  <span className="dot" />
                  <span className="name">{row.name}</span>
                </div>
                {members.map((col) => {
                  const r = row.accountId === col.accountId ? solo(row.accountId) : pair(row.accountId, col.accountId);
                  const label =
                    row.accountId === col.accountId ? `${row.name} (all games)` : `${row.name} + ${col.name}`;
                  if (!r || r.games < min) {
                    return (
                      <div key={col.accountId} className="matrix-cell no-data" aria-label={`${label}: not enough games`}>
                        <span>{r ? r.games : 0}</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={col.accountId}
                      className="matrix-cell"
                      style={cellStyle(r)}
                      aria-label={`${label}: ${pct(winRate(r))} over ${r.games} games`}
                      {...tip(() => <TipBody value={pct(winRate(r))} title={label} rows={[["Games", recordTip(r)]]} />)}
                    >
                      <strong>{pct(winRate(r))}</strong>
                      <span>{r.games}g</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="scale-legend" aria-hidden="true">
            <span>{pct(0.5 - FULL_AT)}</span>
            <span className="ramp" />
            <span>{pct(0.5 + FULL_AT)}+</span>
            <span>· grey: fewer than {LOW_SAMPLE} games</span>
          </div>
        </>
      )}
    </Card>
  );
}
