// Infers each player's position (1 safe lane, 2 mid, 3 offlane, 4 soft support, 5 hard support).
// The Web API has no lane data, so this combines three signals found in match data:
//   - farm: the 3 players on a side with the most last hits are cores, the other 2 supports;
//   - early levels: players take their ultimate the moment they reach level 6, so the time of the
//     6th skill point shows who levelled fastest. Solo mid gets there first. Valve only returns
//     skill timings for recent matches (roughly the last 2-3 months);
//   - hero tendencies: how often each hero lands in each position, learned from the stored
//     matches that do have skill timings.
//
// Checked offline against replay-parsed lanes for 150 public matches (1,439 player-games):
// safe lane 93%, mid 92%, offlane 90%, supports 62% (which support was in which lane is hard).
import type { MatchPlayer } from "./steam.ts";

/** P(position | hero) as five probabilities per hero. */
export type HeroPriors = Map<number, number[]>;

function level6Time(p: MatchPlayer) {
  const upgrades = p.ability_upgrades ?? [];
  return upgrades.length >= 6 ? upgrades[5].time : Number.POSITIVE_INFINITY;
}

function sides(players: MatchPlayer[]) {
  return [true, false]
    .map((radiant) => players.filter((p) => p.player_slot < 128 === radiant))
    .filter((side) => side.length === 5);
}

function splitByFarm(side: MatchPlayer[]) {
  const byFarm = [...side].sort((a, b) => b.last_hits - a.last_hits);
  return { cores: byFarm.slice(0, 3), supports: byFarm.slice(3) };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** Assigns `positions` to `players` in the order that best fits the hero priors. */
function bestFit(players: MatchPlayer[], positions: number[], priors: HeroPriors) {
  const score = (order: MatchPlayer[]) =>
    order.reduce((total, p, i) => total + Math.log(priors.get(p.hero_id)?.[positions[i] - 1] ?? 0.2), 0);
  return permutations(players).reduce((best, order) => (score(order) > score(best) ? order : best));
}

/** Position labels from farm and skill timings only. Used to learn the hero priors. */
function inferFromTimings(side: MatchPlayer[]) {
  const { cores, supports } = splitByFarm(side);
  const mid = cores.reduce((best, p) => (level6Time(p) < level6Time(best) ? p : best));
  const [safe, off] = cores.filter((p) => p !== mid);
  const [hard, soft] = [...supports].sort((a, b) => a.last_hits - b.last_hits);
  return new Map([
    [safe.player_slot, 1],
    [mid.player_slot, 2],
    [off.player_slot, 3],
    [soft.player_slot, 4],
    [hard.player_slot, 5],
  ]);
}

/** Learns P(position | hero) from matches whose players all have skill timings. */
export function learnHeroPriors(matches: { players: MatchPlayer[] }[]): HeroPriors {
  const counts = new Map<number, number[]>();
  for (const match of matches) {
    for (const side of sides(match.players)) {
      if (side.some((p) => !p.ability_upgrades?.length)) continue;
      for (const [slot, position] of inferFromTimings(side)) {
        const hero = side.find((p) => p.player_slot === slot)!.hero_id;
        const c = counts.get(hero) ?? [1, 1, 1, 1, 1]; // Laplace smoothing
        c[position - 1]++;
        counts.set(hero, c);
      }
    }
  }
  return new Map([...counts].map(([hero, c]) => [hero, c.map((n) => n / c.reduce((a, b) => a + b, 0))]));
}

/** Returns player_slot -> position for both sides of a match. */
export function inferPositions(players: MatchPlayer[], priors: HeroPriors) {
  const positions = new Map<number, number>();
  for (const side of sides(players)) {
    const { cores, supports } = splitByFarm(side);
    let coreOrder: MatchPlayer[];
    if (cores.every((p) => level6Time(p) < Number.POSITIVE_INFINITY)) {
      const mid = cores.reduce((best, p) => (level6Time(p) < level6Time(best) ? p : best));
      const [safe, off] = bestFit(cores.filter((p) => p !== mid), [1, 3], priors);
      coreOrder = [safe, mid, off];
    } else {
      coreOrder = bestFit(cores, [1, 2, 3], priors);
    }
    const [soft, hard] = bestFit(supports, [4, 5], priors);
    [...coreOrder, soft, hard].forEach((p, i) => positions.set(p.player_slot, i + 1));
  }
  return positions;
}
