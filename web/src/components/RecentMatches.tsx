import { useState } from "react";
import type { RecentMatch } from "../../../shared/types.ts";
import { duration, queueLabel, timeAgo } from "../format.ts";
import { Card, HeroImg, heroName, playerStyle, useLookup } from "./ui.tsx";

const PAGE = 10;

export function RecentMatches({ matches }: { matches: RecentMatch[] }) {
  const lookup = useLookup();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? matches : matches.slice(0, PAGE);

  return (
    <Card title="Recent matches" subtitle="Newest first · match IDs open on Dotabuff">
      {matches.length === 0 ? (
        <div className="empty-inline">No matches match these filters.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Our heroes</th>
                  <th>Mode</th>
                  <th className="num">Score</th>
                  <th className="num">Length</th>
                  <th className="num">Played</th>
                  <th className="num">Match</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.matchId}>
                    <td>
                      <span className={`result ${m.won ? "win" : "loss"}`} title={m.won ? "Win" : "Loss"}>
                        {m.won ? "W" : "L"}
                      </span>
                    </td>
                    <td>
                      <div className="match-heroes">
                        {m.players.map((p) => {
                          const member = lookup.members.get(p.accountId);
                          return (
                            <div className="match-hero" key={p.accountId} style={playerStyle(member?.colorSlot ?? 0)}>
                              <HeroImg id={p.heroId} size="md" />
                              <div>
                                <span className="chip">
                                  <span className="dot" aria-hidden="true" />
                                  <span className="name">{heroName(lookup.heroes, p.heroId)}</span>
                                </span>
                                <span className="kda tabular">
                                  {member?.name ?? p.accountId} · {p.kills}/{p.deaths}/{p.assists}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="secondary">{queueLabel(m.lobbyType, m.gameMode)}</td>
                    <td className="num secondary">
                      {m.ourScore}–{m.theirScore}
                    </td>
                    <td className="num secondary">{duration(m.duration)}</td>
                    <td className="num secondary">{timeAgo(m.startTime)}</td>
                    <td className="num">
                      <a
                        href={`https://www.dotabuff.com/matches/${m.matchId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="muted"
                      >
                        {m.matchId}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matches.length > PAGE && (
            <div className="table-foot">
              <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show ${matches.length - PAGE} more`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
