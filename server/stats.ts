// Read-only stat queries. Every query starts from the same filtered set of team matches,
// so all numbers on the dashboard agree with each other.
import type {
  Abandons,
  BucketStat,
  ComboStat,
  ComfortStat,
  CompositionFactor,
  Dashboard,
  DuoStat,
  FactorAverages,
  Filters,
  HeroStat,
  LineupStat,
  MatchupStat,
  Mode,
  PlayerFactors,
  PlayerStat,
  Queue,
  RecentMatch,
  RoleStat,
  Sessions,
  Summary,
  TrendPoint,
} from "../shared/types.ts";
import { TEAM_CTES, all, get } from "./db.ts";
import { insights } from "./insights.ts";
import { HERO_ROLES } from "./steam.ts";
import { resolveTeamId } from "./team.ts";

const RANKED = 7;
const UNRANKED = 0;

/** Parses filters from a query string. Returns null when there's no team to show. */
export function parseFilters(sp: URLSearchParams): Filters | null {
  const int = (key: string, fallback: number, lo: number, hi: number) => {
    const n = Number.parseInt(sp.get(key) ?? "", 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const queue = sp.get("queue");
  const mode = sp.get("mode");
  const player = Number.parseInt(sp.get("player") ?? "", 10);
  const position = Number.parseInt(sp.get("position") ?? "", 10);
  const team = resolveTeamId(Number.parseInt(sp.get("team") ?? "", 10) || null);
  if (team === null) return null;
  return {
    team,
    days: int("days", 0, 0, 3650),
    queue: (["all", "ranked", "unranked"] as Queue[]).includes(queue as Queue) ? (queue as Queue) : "all",
    mode: (["all", "normal", "turbo"] as Mode[]).includes(mode as Mode) ? (mode as Mode) : "all",
    stack: int("stack", 1, 1, 5),
    player: Number.isFinite(player) ? player : null,
    position: position >= 1 && position <= 5 ? position : null,
    abandons: (sp.get("abandons") as Abandons) === "include" ? "include" : "exclude",
    min: int("min", 1, 1, 100),
  };
}

function params(f: Filters) {
  return {
    team: f.team,
    since: f.days ? Math.floor(Date.now() / 1000) - f.days * 86400 : 0,
    lobby: f.queue === "ranked" ? RANKED : f.queue === "unranked" ? UNRANKED : null,
    mode: f.mode,
    stack: f.stack,
    player: f.player,
    position: f.position,
    abandons: f.abandons,
    min: f.min,
  };
}

// tm: filtered team matches.
// ours_all: team members on our side. ours: the same, limited to the position filter.
// theirs: everyone on the enemy side.
// The position filter narrows whole matches only when a player is selected ("Storm^ as Mid");
// otherwise it narrows the per-player rows (hero pool, player cards).
const BASE = `
  WITH ${TEAM_CTES},
  tm AS (
    SELECT v.* FROM team_matches v
    WHERE v.stack >= :stack
      AND v.start_time >= :since
      AND (:lobby IS NULL OR v.lobby_type = :lobby)
      AND (:mode = 'all' OR (:mode = 'turbo') = (v.game_mode = 23))
      AND (:abandons = 'include' OR NOT EXISTS (
        SELECT 1 FROM match_players a WHERE a.match_id = v.match_id AND a.leaver_status >= 2))
      AND (:player IS NULL OR EXISTS (
        SELECT 1 FROM match_players p
        WHERE p.match_id = v.match_id AND p.account_id = :player AND p.is_radiant = v.we_radiant
          AND (:position IS NULL OR p.position = :position)))
  ),
  ours_all AS (
    SELECT mp.*, tm.won FROM match_players mp
    JOIN tm ON tm.match_id = mp.match_id
    JOIN members t ON t.account_id = mp.account_id
    WHERE mp.is_radiant = tm.we_radiant
  ),
  ours AS (
    SELECT * FROM ours_all WHERE :position IS NULL OR position = :position
  ),
  theirs AS (
    SELECT mp.*, tm.won FROM match_players mp
    JOIN tm ON tm.match_id = mp.match_id
    WHERE mp.is_radiant != tm.we_radiant
  )
`;

const AVERAGES = `
  AVG(kills) AS kills, AVG(deaths) AS deaths, AVG(assists) AS assists,
  AVG(gold_per_min) AS gpm, AVG(xp_per_min) AS xpm
`;

function query<T>(f: Filters, sql: string) {
  return all<T>(BASE + sql, params(f));
}

export function summary(f: Filters): Summary {
  const row = get<{
    games: number;
    wins: number | null;
    first: number | null;
    last: number | null;
    avgDuration: number | null;
    radiantGames: number | null;
    radiantWins: number | null;
  }>(
    BASE +
      `SELECT COUNT(*) AS games, SUM(won) AS wins, MIN(start_time) AS first, MAX(start_time) AS last,
              AVG(duration) AS avgDuration, SUM(we_radiant) AS radiantGames, SUM(we_radiant * won) AS radiantWins
       FROM tm`,
    params(f),
  )!;
  const form = query<{ won: number }>(f, "SELECT won FROM tm ORDER BY start_time DESC LIMIT 20").map((r) => r.won === 1);

  let streak: Summary["streak"] = null;
  if (form.length) {
    let count = 0;
    while (count < form.length && form[count] === form[0]) count++;
    streak = { won: form[0], count };
  }

  const wins = row.wins ?? 0;
  const radiantGames = row.radiantGames ?? 0;
  const radiantWins = row.radiantWins ?? 0;
  return {
    games: row.games,
    wins,
    firstMatch: row.first,
    lastMatch: row.last,
    avgDuration: row.avgDuration,
    radiant: { games: radiantGames, wins: radiantWins },
    dire: { games: row.games - radiantGames, wins: wins - radiantWins },
    form,
    streak,
  };
}

export function playerHeroes(f: Filters) {
  return query<{ accountId: number; heroId: number; games: number; wins: number }>(
    f,
    `SELECT account_id AS accountId, hero_id AS heroId, COUNT(*) AS games, SUM(won) AS wins
     FROM ours GROUP BY account_id, hero_id ORDER BY games DESC, wins DESC`,
  );
}

export function players(f: Filters): PlayerStat[] {
  const byPlayer = Map.groupBy(playerHeroes(f), (r) => r.accountId);
  return query<Omit<PlayerStat, "topHeroes">>(
    f,
    `SELECT account_id AS accountId, COUNT(*) AS games, SUM(won) AS wins, COUNT(DISTINCT hero_id) AS heroCount, ${AVERAGES}
     FROM ours GROUP BY account_id ORDER BY games DESC`,
  ).map((p) => ({
    ...p,
    topHeroes: (byPlayer.get(p.accountId) ?? []).slice(0, 5).map(({ heroId, games, wins }) => ({ heroId, games, wins })),
  }));
}

export function heroes(f: Filters): HeroStat[] {
  const byHero = Map.groupBy(playerHeroes(f), (r) => r.heroId);
  const positions = new Map<number, number[]>();
  for (const r of query<{ heroId: number; position: number; games: number }>(
    f,
    `SELECT hero_id AS heroId, position, COUNT(*) AS games FROM ours
     WHERE position IS NOT NULL AND (:player IS NULL OR account_id = :player)
     GROUP BY hero_id, position`,
  )) {
    const counts = positions.get(r.heroId) ?? [0, 0, 0, 0, 0];
    counts[r.position - 1] = r.games;
    positions.set(r.heroId, counts);
  }
  return query<Omit<HeroStat, "players">>(
    f,
    `SELECT hero_id AS heroId, COUNT(*) AS games, SUM(won) AS wins, ${AVERAGES}
     FROM ours
     WHERE :player IS NULL OR account_id = :player
     GROUP BY hero_id HAVING COUNT(*) >= :min
     ORDER BY games DESC, wins DESC`,
  ).map((h) => ({
    ...h,
    players: (byHero.get(h.heroId) ?? [])
      .filter((r) => f.player === null || r.accountId === f.player)
      .map(({ accountId, games, wins }) => ({ accountId, games, wins })),
    positions: positions.get(h.heroId) ?? [0, 0, 0, 0, 0],
  }));
}

export function duos(f: Filters): DuoStat[] {
  return query<DuoStat>(
    f,
    `SELECT a.account_id AS a, b.account_id AS b, COUNT(*) AS games, SUM(a.won) AS wins
     FROM ours_all a JOIN ours_all b ON a.match_id = b.match_id AND a.account_id < b.account_id
     GROUP BY a.account_id, b.account_id`,
  );
}

export function combos(f: Filters): ComboStat[] {
  return query<{ h1: number; h2: number; games: number; wins: number }>(
    f,
    `SELECT a.hero_id AS h1, b.hero_id AS h2, COUNT(*) AS games, SUM(a.won) AS wins
     FROM ours_all a JOIN ours_all b ON a.match_id = b.match_id AND a.hero_id < b.hero_id
     WHERE :player IS NULL OR a.account_id = :player OR b.account_id = :player
     GROUP BY a.hero_id, b.hero_id HAVING COUNT(*) >= MAX(:min, 2)
     ORDER BY games DESC`,
  ).map(({ h1, h2, games, wins }) => ({ heroes: [h1, h2], games, wins }));
}

export function matchups(f: Filters): MatchupStat[] {
  return query<MatchupStat>(
    f,
    `SELECT hero_id AS heroId, COUNT(*) AS games, SUM(won) AS wins
     FROM theirs GROUP BY hero_id HAVING COUNT(*) >= :min ORDER BY games DESC`,
  );
}

const LENGTH_BUCKETS = [
  { key: "lt25", label: "Under 25 min", max: 25 * 60 },
  { key: "25to35", label: "25–35 min", max: 35 * 60 },
  { key: "35to45", label: "35–45 min", max: 45 * 60 },
  { key: "gt45", label: "45+ min", max: Infinity },
];

export function byLength(f: Filters): BucketStat[] {
  const rows = query<{ duration: number; won: number }>(f, "SELECT duration, won FROM tm");
  return LENGTH_BUCKETS.map(({ key, label, max }, i) => {
    const min = i === 0 ? 0 : LENGTH_BUCKETS[i - 1].max;
    const inBucket = rows.filter((r) => r.duration >= min && r.duration < max);
    return { key, label, games: inBucket.length, wins: inBucket.filter((r) => r.won === 1).length };
  });
}

export function byStack(f: Filters): BucketStat[] {
  const rows = query<{ stack: number; games: number; wins: number }>(
    f,
    "SELECT stack, COUNT(*) AS games, SUM(won) AS wins FROM tm GROUP BY stack",
  );
  return [1, 2, 3, 4, 5]
    .filter((n) => n >= f.stack)
    .map((n) => {
      const r = rows.find((row) => row.stack === n);
      return { key: String(n), label: `${n} of us`, games: r?.games ?? 0, wins: r?.wins ?? 0 };
    });
}

export function recent(f: Filters, limit = 25): RecentMatch[] {
  const matches = query<{
    matchId: number;
    startTime: number;
    duration: number;
    lobbyType: number;
    gameMode: number;
    won: number;
    weRadiant: number;
    stack: number;
    radiantScore: number | null;
    direScore: number | null;
  }>(
    f,
    `SELECT match_id AS matchId, start_time AS startTime, duration, lobby_type AS lobbyType, game_mode AS gameMode,
            won, we_radiant AS weRadiant, stack, radiant_score AS radiantScore, dire_score AS direScore
     FROM tm ORDER BY start_time DESC LIMIT ${limit}`,
  );
  const rows = query<RecentMatch["players"][number] & { matchId: number }>(
    f,
    `SELECT match_id AS matchId, account_id AS accountId, hero_id AS heroId, kills, deaths, assists
     FROM ours WHERE match_id IN (SELECT match_id FROM tm ORDER BY start_time DESC LIMIT ${limit})
     ORDER BY player_slot`,
  );
  const byMatch = Map.groupBy(rows, (r) => r.matchId);

  return matches.map((m) => {
    const radiant = m.radiantScore ?? 0;
    const dire = m.direScore ?? 0;
    return {
      matchId: m.matchId,
      startTime: m.startTime,
      duration: m.duration,
      lobbyType: m.lobbyType,
      gameMode: m.gameMode,
      won: m.won === 1,
      weRadiant: m.weRadiant === 1,
      stack: m.stack,
      ourScore: m.weRadiant ? radiant : dire,
      theirScore: m.weRadiant ? dire : radiant,
      players: (byMatch.get(m.matchId) ?? []).map(({ accountId, heroId, kills, deaths, assists }) => ({
        accountId,
        heroId,
        kills,
        deaths,
        assists,
      })),
    };
  });
}

export function roles(f: Filters): RoleStat[] {
  return query<RoleStat>(
    f,
    `SELECT account_id AS accountId, position, COUNT(*) AS games, SUM(won) AS wins
     FROM ours_all WHERE position IS NOT NULL GROUP BY account_id, position`,
  );
}

/** Which exact groups of team members win together (2+ members on our side). */
export function lineups(f: Filters): LineupStat[] {
  const rows = query<{ matchId: number; accountId: number; won: number }>(
    f,
    "SELECT match_id AS matchId, account_id AS accountId, won FROM ours_all",
  );
  const groups = new Map<string, LineupStat>();
  for (const members of Map.groupBy(rows, (r) => r.matchId).values()) {
    if (members.length < 2) continue;
    const players = members.map((r) => r.accountId).sort((a, b) => a - b);
    const key = players.join(",");
    const group = groups.get(key) ?? { players, games: 0, wins: 0 };
    group.games++;
    group.wins += members[0].won;
    groups.set(key, group);
  }
  // A lineup needs a few games together before its win rate means anything.
  return [...groups.values()].filter((g) => g.games >= Math.max(3, f.min)).sort((a, b) => b.games - a.games);
}

export function factors(f: Filters): PlayerFactors[] {
  const rows = query<FactorAverages & { accountId: number; won: number; games: number }>(
    f,
    `SELECT account_id AS accountId, won, COUNT(*) AS games,
            AVG(kills) AS kills, AVG(deaths) AS deaths, AVG(assists) AS assists,
            AVG(gold_per_min) AS gpm, AVG(xp_per_min) AS xpm, AVG(last_hits) AS lastHits,
            AVG(hero_damage) AS heroDamage, AVG(tower_damage) AS towerDamage, AVG(hero_healing) AS heroHealing
     FROM ours GROUP BY account_id, won`,
  );
  return [...Map.groupBy(rows, (r) => r.accountId)].flatMap(([accountId, results]) => {
    const win = results.find((r) => r.won === 1);
    const loss = results.find((r) => r.won === 0);
    if (!win || !loss) return [];
    const averages = ({ accountId: _id, won: _won, ...rest }: (typeof results)[number]) => rest;
    return [{ accountId, wins: averages(win), losses: averages(loss) }];
  });
}

const COMFORT_POOL = 5;

export function comfort(f: Filters): ComfortStat[] {
  const total = (rows: { games: number; wins: number }[]) => ({
    games: rows.reduce((n, r) => n + r.games, 0),
    wins: rows.reduce((n, r) => n + r.wins, 0),
  });
  return [...Map.groupBy(playerHeroes(f), (r) => r.accountId)]
    .map(([accountId, heroRows]) => ({
      accountId,
      heroes: heroRows.slice(0, COMFORT_POOL).map((h) => h.heroId),
      comfort: total(heroRows.slice(0, COMFORT_POOL)),
      other: total(heroRows.slice(COMFORT_POOL)),
    }))
    .filter((c) => c.other.games > 0);
}

export function trend(f: Filters): TrendPoint[] {
  const rows = query<{ start_time: number; won: number }>(f, "SELECT start_time, won FROM tm ORDER BY start_time");
  if (rows.length === 0) return [];
  const weekly = f.days > 0 && f.days <= 90;
  const bucketStart = (t: number) => {
    const d = new Date(t * 1000);
    d.setHours(0, 0, 0, 0);
    if (weekly) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    else d.setDate(1);
    return d;
  };
  const points: TrendPoint[] = [];
  const end = bucketStart(rows[rows.length - 1].start_time);
  // Walk every week/month in range so gaps show up as empty points instead of being skipped.
  for (const d = bucketStart(rows[0].start_time); d <= end; weekly ? d.setDate(d.getDate() + 7) : d.setMonth(d.getMonth() + 1)) {
    points.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", weekly ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" }),
      games: 0,
      wins: 0,
    });
  }
  let i = 0;
  for (const r of rows) {
    const key = bucketStart(r.start_time).toISOString().slice(0, 10);
    while (points[i].key !== key) i++;
    points[i].games++;
    points[i].wins += r.won;
  }
  return points;
}

// A new session starts after two hours without a game.
const SESSION_GAP = 2 * 3600;
const bucket = (key: string, label: string): BucketStat => ({ key, label, games: 0, wins: 0 });

export function sessions(f: Filters): Sessions {
  // Session order comes from every stored team game, so a filter can't change which game
  // counts as "the 3rd of the night".
  const order = all<{ match_id: number; start_time: number; duration: number; won: number }>(
    `WITH ${TEAM_CTES} SELECT match_id, start_time, duration, won FROM team_matches ORDER BY start_time`,
    { team: f.team },
  );
  const included = new Set(query<{ match_id: number }>(f, "SELECT match_id FROM tm").map((r) => r.match_id));

  const byGameNumber = ["1st", "2nd", "3rd", "4th", "5th+"].map((label, i) => bucket(String(i + 1), label));
  const afterResult = [bucket("first", "First game"), bucket("win", "After a win"), bucket("loss", "After a loss")];
  const byTimeOfDay = [
    bucket("morning", "Morning 6–12"),
    bucket("afternoon", "Afternoon 12–18"),
    bucket("evening", "Evening 18–24"),
    bucket("night", "Night 0–6"),
  ];
  const byWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => bucket(label.toLowerCase(), label));
  const add = (b: BucketStat, won: number) => {
    b.games++;
    b.wins += won;
  };

  let previousEnd = Number.NEGATIVE_INFINITY;
  let previousWon = 0;
  let index = 0;
  for (const m of order) {
    const newSession = m.start_time - previousEnd > SESSION_GAP;
    index = newSession ? 1 : index + 1;
    if (included.has(m.match_id)) {
      const hour = new Date(m.start_time * 1000).getHours();
      add(byGameNumber[Math.min(index, 5) - 1], m.won);
      add(newSession ? afterResult[0] : previousWon ? afterResult[1] : afterResult[2], m.won);
      add(byTimeOfDay[hour < 6 ? 3 : hour < 12 ? 0 : hour < 18 ? 1 : 2], m.won);
      add(byWeekday[(new Date(m.start_time * 1000).getDay() + 6) % 7], m.won);
    }
    previousEnd = m.start_time + m.duration;
    previousWon = m.won;
  }
  return { byGameNumber, afterResult, byTimeOfDay, byWeekday };
}

const ROLE_FACTOR_LABELS: Partial<Record<(typeof HERO_ROLES)[number], string>> = {
  Carry: "Carries",
  Support: "Supports",
  Nuker: "Nukers",
  Disabler: "Disablers",
  Durable: "Durable heroes",
  Escape: "Escape heroes",
  Pusher: "Pushers",
  Initiator: "Initiators",
};
const MIN_BUCKET_GAMES = 15;

/** How our full draft (all 5 heroes on our side) relates to winning. */
export function composition(f: Filters): CompositionFactor[] {
  const rows = query<{ matchId: number; won: number; roles: string | null; attack: number | null }>(
    f,
    `SELECT mp.match_id AS matchId, tm.won, h.role_levels AS roles, h.attack_capability AS attack
     FROM match_players mp
     JOIN tm ON tm.match_id = mp.match_id
     JOIN heroes h ON h.id = mp.hero_id
     WHERE mp.is_radiant = tm.we_radiant`,
  );
  if (rows.length === 0 || rows.some((r) => r.roles === null)) return [];

  const counts = new Map<string, number[]>(); // factor key -> per-match counts
  const won: number[] = [];
  for (const draft of Map.groupBy(rows, (r) => r.matchId).values()) {
    won.push(draft[0].won);
    const levels = draft.map((h) => JSON.parse(h.roles!) as number[]);
    HERO_ROLES.forEach((role, i) => {
      if (!ROLE_FACTOR_LABELS[role]) return;
      // Valve rates each role 0-3; 2+ means the hero is genuinely built for it.
      counts.set(role, [...(counts.get(role) ?? []), levels.filter((l) => (l[i] ?? 0) >= 2).length]);
    });
    counts.set("melee", [...(counts.get("melee") ?? []), draft.filter((h) => h.attack === 1).length]);
  }

  const factors: CompositionFactor[] = [];
  for (const [key, perMatch] of counts) {
    const buckets = [bucket("0-1", "0–1"), bucket("2", "2"), bucket("3+", "3+")];
    perMatch.forEach((n, i) => {
      const b = buckets[Math.min(Math.max(n - 1, 0), 2)];
      b.games++;
      b.wins += won[i];
    });
    const rates = buckets.filter((b) => b.games >= MIN_BUCKET_GAMES).map((b) => b.wins / b.games);
    const label = key === "melee" ? "Melee heroes" : ROLE_FACTOR_LABELS[key as (typeof HERO_ROLES)[number]]!;
    factors.push({ key, label, buckets, spread: rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : 0 });
  }
  return factors.sort((a, b) => b.spread - a.spread);
}

export const sections = {
  summary,
  players,
  heroes,
  duos,
  combos,
  matchups,
  byLength,
  byStack,
  recent: (f: Filters) => recent(f),
  roles,
  lineups,
  factors,
  comfort,
  trend,
  sessions,
  composition,
  insights: (f: Filters) => dashboard(f).insights,
};

export function dashboard(f: Filters): Dashboard {
  const data = {
    filters: f,
    summary: summary(f),
    players: players(f),
    heroes: heroes(f),
    duos: duos(f),
    combos: combos(f),
    matchups: matchups(f),
    byLength: byLength(f),
    byStack: byStack(f),
    recent: recent(f),
    roles: roles(f),
    lineups: lineups(f),
    factors: factors(f),
    comfort: comfort(f),
    trend: trend(f),
    sessions: sessions(f),
    composition: composition(f),
  };
  return { ...data, insights: insights(data, playerHeroes(f)) };
}
