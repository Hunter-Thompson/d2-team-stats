// Thin client for the Steam Web API endpoints this project uses.
// GetMatchDetails currently returns HTTP 500, so full match data comes from
// GetMatchHistoryBySequenceNum using the match_seq_num that GetMatchHistory provides.
import { config } from "./config.ts";

const BASE = "https://api.steampowered.com";
const MIN_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 5;

export interface HistoryPlayer {
  account_id?: number;
  player_slot: number;
  hero_id: number;
}

export interface HistoryMatch {
  match_id: number;
  match_seq_num: number;
  start_time: number;
  lobby_type: number;
  players: HistoryPlayer[];
}

export interface HistoryResult {
  status: number;
  statusDetail?: string;
  total_results?: number;
  results_remaining?: number;
  matches?: HistoryMatch[];
}

export interface MatchPlayer {
  account_id?: number;
  player_slot: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  gold_per_min: number;
  xp_per_min: number;
  level: number;
  net_worth: number;
  hero_damage: number;
  tower_damage: number;
  hero_healing: number;
  leaver_status: number;
  // One entry per skill point spent; `time` is seconds into the match.
  ability_upgrades?: { ability: number; time: number; level: number }[];
}

export interface MatchDetail {
  match_id: number;
  match_seq_num: number;
  radiant_win: boolean;
  duration: number;
  start_time: number;
  lobby_type: number;
  game_mode: number;
  radiant_score: number;
  dire_score: number;
  first_blood_time: number;
  human_players: number;
  players: MatchPlayer[];
}

export interface PlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarmedium: string;
}

export class SteamApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await sleep(wait);
}

async function call<T>(endpoint: string, params: Record<string, string | number>): Promise<T> {
  if (!config.steamApiKey) throw new Error("STEAM_API_KEY is not set. Add it to .env.");
  const url = new URL(endpoint, BASE);
  url.searchParams.set("key", config.steamApiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 1; ; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    // Never include the URL in errors: it carries the API key.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new SteamApiError(`Steam API ${endpoint} returned HTTP ${res.status}`, res.status);
  }
}

export async function getMatchHistory(accountId: number, startAtMatchId?: number) {
  const params: Record<string, number> = { account_id: accountId, matches_requested: 100 };
  if (startAtMatchId) params.start_at_match_id = startAtMatchId;
  const body = await call<{ result: HistoryResult }>("/IDOTA2Match_570/GetMatchHistory/v1/", params);
  return body.result;
}

export async function getMatchBySeqNum(seqNum: number) {
  const body = await call<{ result: { status: number; matches?: MatchDetail[] } }>(
    "/IDOTA2Match_570/GetMatchHistoryBySequenceNum/v1/",
    { start_at_match_seq_num: seqNum, matches_requested: 1 },
  );
  return body.result.matches?.[0] ?? null;
}

export async function getHeroes() {
  const body = await call<{ result: { heroes: { id: number; name: string; localized_name: string }[] } }>(
    "/IEconDOTA2_570/GetHeroes/v1/",
    { language: "english" },
  );
  return body.result.heroes;
}

export interface HeroDetails {
  id: number;
  primary_attr: number; // 0 strength, 1 agility, 2 intelligence, 3 universal
  attack_capability: number; // 1 melee, 2 ranged
  complexity: number;
  role_levels: number[]; // indexed like HERO_ROLES, 0-3
}

// Order of `role_levels` in Valve's hero data feed.
export const HERO_ROLES = [
  "Carry",
  "Support",
  "Nuker",
  "Disabler",
  "Jungler",
  "Durable",
  "Escape",
  "Pusher",
  "Initiator",
] as const;

/** Hero attributes and role tags from Valve's dota2.com data feed (no key needed). */
export async function getHeroDetails(heroId: number): Promise<HeroDetails | null> {
  const res = await fetch(`https://www.dota2.com/datafeed/herodata?language=english&hero_id=${heroId}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: { data?: { heroes?: HeroDetails[] } } };
  return body.result?.data?.heroes?.[0] ?? null;
}

/**
 * A player's registered pro name from Valve's esports data, or null if they aren't a pro.
 * The endpoint also returns names from amateur tournaments (e.g. Battle Cup), so only players with
 * a pro registration count.
 */
export async function getProName(accountId: number): Promise<string | null> {
  const res = await fetch(`https://www.dota2.com/webapi/IDOTA2Fantasy/GetPlayerInfo/v001?account_id=${accountId}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { name?: string; pro_registration?: unknown[] };
  return body.pro_registration?.length ? body.name?.trim() || null : null;
}

export async function getPlayerSummaries(steamIds: string[]) {
  if (steamIds.length === 0) return [];
  const body = await call<{ response: { players: PlayerSummary[] } }>(
    "/ISteamUser/GetPlayerSummaries/v2/",
    { steamids: steamIds.join(",") },
  );
  return body.response.players;
}

export async function resolveVanityUrl(vanity: string) {
  const body = await call<{ response: { success: number; steamid?: string } }>(
    "/ISteamUser/ResolveVanityURL/v1/",
    { vanityurl: vanity },
  );
  return body.response.success === 1 ? (body.response.steamid ?? null) : null;
}
