import { POSITION_LABELS, type Member, type PlayerStat, type RoleStat } from "../../../shared/types.ts";
import { kda, pct, winRate } from "../format.ts";
import { mainRole } from "./Roles.tsx";
import { Card, HeroImg, TipBody, heroName, playerStyle, recordTip, useLookup, useTip } from "./ui.tsx";

export function Players({
  members,
  players,
  roles,
  selected,
  onSelect,
}: {
  members: Member[];
  players: PlayerStat[];
  roles: RoleStat[];
  selected: number | null;
  onSelect: (accountId: number | null) => void;
}) {
  const { heroes } = useLookup();
  const tip = useTip();
  const byId = new Map(players.map((p) => [p.accountId, p]));
  const ordered = [...members].sort((a, b) => (byId.get(b.accountId)?.games ?? 0) - (byId.get(a.accountId)?.games ?? 0));

  return (
    <Card title="Players" subtitle="Click a player to focus the whole dashboard on them">
      <div className="players">
        {ordered.map((m) => {
          const p = byId.get(m.accountId);
          return (
            <button
              key={m.accountId}
              type="button"
              className="player-card"
              style={playerStyle(m.colorSlot)}
              aria-pressed={selected === m.accountId}
              onClick={() => onSelect(selected === m.accountId ? null : m.accountId)}
            >
              <div className="player-top">
                {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : <span className="avatar-fallback" />}
                <div style={{ minWidth: 0 }}>
                  <div className="player-name">{m.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p ? `${p.games} games · ${p.heroCount} heroes` : "No games in this view"}
                  </div>
                  {(() => {
                    const role = mainRole(roles, m.accountId);
                    return role ? (
                      <div className="secondary" style={{ fontSize: 12 }}>
                        Mostly {POSITION_LABELS[role.position]} · {pct(role.share)}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
              {p && (
                <>
                  <div className="player-stats">
                    <div>
                      <strong>{pct(winRate(p))}</strong>
                      <span>win rate</span>
                    </div>
                    <div>
                      <strong className="tabular">{kda(p.kills, p.deaths, p.assists)}</strong>
                      <span>K / D / A</span>
                    </div>
                    <div>
                      <strong>{Math.round(p.gpm)}</strong>
                      <span>GPM</span>
                    </div>
                  </div>
                  <div className="top-heroes">
                    {p.topHeroes.map((h) => (
                      <span
                        key={h.heroId}
                        className="top-hero"
                        {...tip(() => (
                          <TipBody
                            value={pct(winRate(h))}
                            title={heroName(heroes, h.heroId)}
                            rows={[["Games", recordTip(h)]]}
                          />
                        ))}
                        tabIndex={-1}
                      >
                        <HeroImg id={h.heroId} size="md" />
                        <span className="tabular">{h.games}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
