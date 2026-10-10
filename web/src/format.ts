import type { WinLoss } from "../../shared/types.ts";

export const winRate = (r: WinLoss) => (r.games ? r.wins / r.games : 0);

/**
 * Lower bound of the 95% Wilson score interval. Ranks win rates by how sure we can be of them,
 * so 3–0 doesn't outrank 30–10.
 */
export function confidentRate(wins: number, games: number) {
  if (!games) return 0;
  const z2 = 1.96 ** 2;
  const p = wins / games;
  const centre = p + z2 / (2 * games);
  const spread = 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games);
  return (centre - spread) / (1 + z2 / games);
}

export const pct =(r: number) => `${Math.round(r * 100)}%`;

export const record = (r: WinLoss) => `${r.wins}–${r.games - r.wins}`;

export const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export const kda = (k: number, d: number, a: number) => `${oneDecimal(k)} / ${oneDecimal(d)} / ${oneDecimal(a)}`;

export function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(unixSeconds: number) {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function shortDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const GAME_MODES: Record<number, string> = {
  1: "All Pick",
  2: "Captains Mode",
  3: "Random Draft",
  4: "Single Draft",
  5: "All Random",
  16: "Captains Draft",
  18: "Ability Draft",
  20: "All Random Deathmatch",
  21: "1v1 Mid",
  22: "All Pick",
  23: "Turbo",
};

export function queueLabel(lobbyType: number, gameMode: number) {
  if (gameMode === 23) return "Turbo";
  const mode = GAME_MODES[gameMode] ?? "Custom";
  return lobbyType === 7 ? `Ranked ${mode}` : mode;
}
