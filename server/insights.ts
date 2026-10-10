// Turns the dashboard numbers into plain findings ("Storm^ wins 63% on Mid").
//
// Each candidate compares a group of games against the rest with a two-proportion z-test.
// Hundreds of candidates are tested, so some would look significant by chance. Findings that
// survive the Benjamini–Hochberg correction (false discovery rate 10%) are marked "strong";
// others with p < 0.05 are marked "possible". Everything else is dropped.
import { POSITION_LABELS, type Dashboard, type Insight, type WinLoss } from "../shared/types.ts";
import { all } from "./db.ts";

type Data = Omit<Dashboard, "insights">;
type Candidate = Omit<Insight, "kind" | "confidence" | "p" | "detail"> & { otherwise: string };

const P_MAX = 0.05;
const FDR = 0.1;
const LIMIT = 24;

// Abramowitz & Stegun 7.1.26; accurate to ~1e-7, plenty for p-values.
function normalCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Two-sided p-value that two win rates differ. */
function pValue(a: WinLoss, b: WinLoss) {
  if (!a.games || !b.games) return 1;
  const pooled = (a.wins + b.wins) / (a.games + b.games);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.games + 1 / b.games));
  if (se === 0) return 1;
  const z = (a.wins / a.games - b.wins / b.games) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

const minus = (total: WinLoss, part: WinLoss): WinLoss => ({
  games: total.games - part.games,
  wins: total.wins - part.wins,
});
const sum = (rows: WinLoss[]): WinLoss => ({
  games: rows.reduce((n, r) => n + r.games, 0),
  wins: rows.reduce((n, r) => n + r.wins, 0),
});
const pct = (r: WinLoss) => `${Math.round((r.wins / r.games) * 100)}%`;

function names() {
  const members = new Map(
    all<{ account_id: number; name: string | null }>(
      "SELECT account_id, COALESCE(NULLIF(pro_name, ''), persona_name) AS name FROM team_members",
    ).map((m) => [m.account_id, m.name ?? String(m.account_id)]),
  );
  const heroes = new Map(
    all<{ id: number; localized_name: string }>("SELECT id, localized_name FROM heroes").map((h) => [h.id, h.localized_name]),
  );
  return {
    player: (id: number) => members.get(id) ?? String(id),
    hero: (id: number) => heroes.get(id) ?? `Hero ${id}`,
  };
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function insights(data: Data, playerHeroes: { accountId: number; heroId: number; games: number; wins: number }[]) {
  const n = names();
  const total: WinLoss = data.summary;
  const candidates: Candidate[] = [];
  const add = (c: Omit<Candidate, "players" | "heroes"> & Partial<Pick<Candidate, "players" | "heroes">>, min: number) => {
    if (c.group.games >= min && c.rest.games >= min) candidates.push({ players: [], heroes: [], ...c });
  };

  // Each player's games, by role (from all of their games, not just one position).
  const roleRows = Map.groupBy(data.roles, (r) => r.accountId);
  const playerTotals = new Map([...roleRows].map(([id, rows]) => [id, sum(rows)]));

  for (const [accountId, rows] of roleRows) {
    for (const r of rows) {
      add(
        {
          id: `role-${accountId}-${r.position}`,
          category: "Role",
          title: `${n.player(accountId)} on ${POSITION_LABELS[r.position]}`,
          players: [accountId],
          group: r,
          rest: minus(playerTotals.get(accountId)!, r),
          otherwise: "in other roles",
        },
        8,
      );
    }
  }

  // Each player's heroes.
  const heroTotals = new Map([...Map.groupBy(playerHeroes, (r) => r.accountId)].map(([id, rows]) => [id, sum(rows)]));
  for (const r of playerHeroes) {
    add(
      {
        id: `hero-${r.accountId}-${r.heroId}`,
        category: "Hero",
        title: `${n.player(r.accountId)} on ${n.hero(r.heroId)}`,
        players: [r.accountId],
        heroes: [r.heroId],
        group: r,
        rest: minus(heroTotals.get(r.accountId)!, r),
        otherwise: "on other heroes",
      },
      6,
    );
  }

  // Playing with each party mate.
  for (const [accountId, games] of playerTotals) {
    if (games.games === total.games) continue; // someone in every game can't be compared
    add(
      {
        id: `with-${accountId}`,
        category: "Teammate",
        title: `Playing with ${n.player(accountId)}`,
        players: [accountId],
        group: games,
        rest: minus(total, games),
        otherwise: "without them",
      },
      10,
    );
  }

  for (const l of data.lineups.filter((l) => l.players.length >= 3)) {
    add(
      {
        id: `lineup-${l.players.join("-")}`,
        category: "Lineup",
        title: `${list(l.players.map(n.player))} together`,
        players: l.players,
        group: l,
        rest: minus(total, l),
        otherwise: "in other games",
      },
      6,
    );
  }

  for (const c of data.combos) {
    add(
      {
        id: `combo-${c.heroes.join("-")}`,
        category: "Hero combo",
        title: `${n.hero(c.heroes[0])} + ${n.hero(c.heroes[1])}`,
        heroes: c.heroes,
        group: c,
        rest: minus(total, c),
        otherwise: "in other games",
      },
      6,
    );
  }

  for (const m of data.matchups) {
    add(
      {
        id: `enemy-${m.heroId}`,
        category: "Enemy hero",
        title: `Against ${n.hero(m.heroId)}`,
        heroes: [m.heroId],
        group: m,
        rest: minus(total, m),
        otherwise: "in other games",
      },
      10,
    );
  }

  const buckets = (
    category: string,
    rows: { key: string; label: string; games: number; wins: number }[],
    title: (label: string) => string,
    min = 15,
  ) => {
    for (const b of rows) {
      add({ id: `${category}-${b.key}`, category, title: title(b.label), group: b, rest: minus(total, b), otherwise: "in other games" }, min);
    }
  };
  buckets("Game length", data.byLength, (label) => `Games lasting ${label.toLowerCase()}`);
  buckets("Party size", data.byStack, (label) => (label === "1 of us" ? "Playing without party mates" : `${label} in the game`));
  buckets("Time of day", data.sessions.byTimeOfDay, (label) => `Playing in the ${label.split(" ")[0].toLowerCase()}`);

  // Fatigue and tilt compare against specific baselines rather than "everything else".
  const [first, second, third, ...later] = data.sessions.byGameNumber;
  add(
    {
      id: "session-late",
      category: "Session",
      title: "Game 4 or later in a session",
      group: sum(later),
      rest: sum([first, second, third]),
      otherwise: "in the first 3 games",
    },
    15,
  );
  const [, afterWin, afterLoss] = data.sessions.afterResult;
  add(
    { id: "session-after-loss", category: "Session", title: "Queueing right after a loss", group: afterLoss, rest: afterWin, otherwise: "right after a win" },
    15,
  );
  const weekend = sum(data.sessions.byWeekday.slice(5));
  add(
    { id: "weekend", category: "Day", title: "Playing on weekends", group: weekend, rest: minus(total, weekend), otherwise: "on weekdays" },
    15,
  );
  add(
    { id: "side-radiant", category: "Side", title: "Playing Radiant", group: data.summary.radiant, rest: data.summary.dire, otherwise: "on Dire" },
    30,
  );

  for (const factor of data.composition) {
    for (const b of factor.buckets) {
      add(
        {
          id: `comp-${factor.key}-${b.key}`,
          category: "Draft",
          title: `Drafts with ${b.label} ${factor.label.toLowerCase()}`,
          group: b,
          rest: minus(total, b),
          otherwise: "with other drafts",
        },
        15,
      );
    }
  }

  // Score, then Benjamini–Hochberg: the k-th smallest p-value passes if p <= k/m * FDR.
  const scored = candidates.map((c) => ({ ...c, p: pValue(c.group, c.rest) })).sort((a, b) => a.p - b.p);
  let passing = 0;
  scored.forEach((c, i) => {
    if (c.p <= ((i + 1) / scored.length) * FDR) passing = i + 1;
  });

  return scored
    .filter((c) => c.p < P_MAX)
    .slice(0, LIMIT)
    .map(({ otherwise, ...c }, i): Insight => ({
      ...c,
      kind: c.group.wins / c.group.games >= c.rest.wins / c.rest.games ? "good" : "bad",
      confidence: i < passing ? "strong" : "possible",
      detail: `${pct(c.group)} win rate over ${c.group.games} games, vs ${pct(c.rest)} ${otherwise}`,
    }));
}
