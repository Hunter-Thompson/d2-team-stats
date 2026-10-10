// Shapes returned by the HTTP API, shared by the server and the dashboard.

export type Queue = "all" | "ranked" | "unranked";
export type Mode = "all" | "normal" | "turbo";
export type Abandons = "exclude" | "include";

export interface Filters {
  team: number; // which tracked player's view
  days: number; // 0 = all time
  queue: Queue;
  mode: Mode;
  stack: number; // minimum team members on our side
  player: number | null; // account_id, or null for the whole team
  position: number | null; // inferred position 1-5, or null for any
  abandons: Abandons; // games where someone abandoned
  min: number; // minimum games for hero / combo / matchup rows
}

// Inferred from farm, early levels and hero tendencies; see server/roles.ts.
export const POSITION_LABELS: Record<number, string> = {
  1: "Safe lane",
  2: "Mid",
  3: "Offlane",
  4: "Soft support",
  5: "Hard support",
};

// How often the inferred lane matched replay-parsed lanes (150 public matches, checked offline).
export const POSITION_ACCURACY: Record<number, number> = { 1: 0.93, 2: 0.92, 3: 0.9, 4: 0.62, 5: 0.62 };

export type HistoryStatus = "pending" | "ok" | "private" | "error";

export interface Member {
  accountId: number;
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  colorSlot: number; // 1-8, or 0 for the shared neutral color
  historyStatus: HistoryStatus;
  lastSyncedAt: number | null;
  source: "manual" | "auto"; // auto = detected as a party mate
  note: string | null;
}

/** One tracked player's view: that player plus the party mates found for them. */
export interface Team {
  id: number;
  name: string;
  accountId: number | null; // the tracked player
  avatarUrl: string | null;
  memberCount: number;
}

export interface Hero {
  id: number;
  name: string;
  localizedName: string;
}

export interface SyncStatus {
  running: boolean;
  teamId: number | null; // the team being synced, or null for all of them
  phase: string;
  done: number;
  total: number;
  message: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  newMatches: number;
}

export interface Meta {
  team: Team | null;
  teams: Team[];
  members: Member[];
  heroes: Record<number, Hero>;
  sync: SyncStatus;
  storedMatches: number;
}

export interface WinLoss {
  games: number;
  wins: number;
}

export interface Summary extends WinLoss {
  firstMatch: number | null;
  lastMatch: number | null;
  avgDuration: number | null;
  radiant: WinLoss;
  dire: WinLoss;
  form: boolean[]; // most recent first
  streak: { won: boolean; count: number } | null;
}

export interface Averages {
  kills: number;
  deaths: number;
  assists: number;
  gpm: number;
  xpm: number;
}

export interface PlayerStat extends WinLoss, Averages {
  accountId: number;
  heroCount: number;
  topHeroes: (WinLoss & { heroId: number })[];
}

export interface HeroStat extends WinLoss, Averages {
  heroId: number;
  players: (WinLoss & { accountId: number })[];
  positions: number[]; // games per inferred position, index 0 = position 1
}

export interface RoleStat extends WinLoss {
  accountId: number;
  position: number;
}

export interface LineupStat extends WinLoss {
  players: number[];
}

// null when no game in the group has the stat (Valve drops damage figures from older matches).
export interface FactorAverages {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gpm: number | null;
  xpm: number | null;
  lastHits: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
}

/** A player's averages in wins vs losses: what changes when we lose. */
export interface PlayerFactors {
  accountId: number;
  wins: FactorAverages & { games: number };
  losses: FactorAverages & { games: number };
}

/** Win rate on a player's most played heroes vs everything else. */
export interface ComfortStat {
  accountId: number;
  heroes: number[];
  comfort: WinLoss;
  other: WinLoss;
}

export interface TrendPoint extends WinLoss {
  key: string;
  label: string;
}

/** Win rate split by how many heroes in our draft have a role (e.g. 3+ disablers). */
export interface CompositionFactor {
  key: string;
  label: string;
  buckets: BucketStat[];
  spread: number; // largest win-rate gap between buckets with enough games
}

export interface Sessions {
  byGameNumber: BucketStat[];
  afterResult: BucketStat[];
  byTimeOfDay: BucketStat[];
  byWeekday: BucketStat[];
}

export interface Insight {
  id: string;
  kind: "good" | "bad";
  confidence: "strong" | "possible";
  category: string;
  title: string;
  detail: string;
  players: number[];
  heroes: number[];
  group: WinLoss; // the games the finding is about
  rest: WinLoss; // the games it's compared against
  p: number;
}

export interface DuoStat extends WinLoss {
  a: number;
  b: number;
}

export interface ComboStat extends WinLoss {
  heroes: [number, number];
}

export interface MatchupStat extends WinLoss {
  heroId: number;
}

export interface BucketStat extends WinLoss {
  key: string;
  label: string;
}

export interface RecentMatch {
  matchId: number;
  startTime: number;
  duration: number;
  lobbyType: number;
  gameMode: number;
  won: boolean;
  weRadiant: boolean;
  stack: number;
  ourScore: number;
  theirScore: number;
  players: { accountId: number; heroId: number; kills: number; deaths: number; assists: number }[];
}

export interface Dashboard {
  filters: Filters;
  summary: Summary;
  players: PlayerStat[];
  heroes: HeroStat[];
  duos: DuoStat[];
  combos: ComboStat[];
  matchups: MatchupStat[];
  byLength: BucketStat[];
  byStack: BucketStat[];
  recent: RecentMatch[];
  roles: RoleStat[];
  lineups: LineupStat[];
  factors: PlayerFactors[];
  comfort: ComfortStat[];
  trend: TrendPoint[];
  sessions: Sessions;
  composition: CompositionFactor[];
  insights: Insight[];
}
