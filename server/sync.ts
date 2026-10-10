// Pulls the team's games from the Steam Web API into SQLite.
//
// 1. GetMatchHistory for every manually added player (newest first, up to Valve's 500-match cap).
//    Only games with one of those players count, so party mates' own histories aren't needed.
// 2. Every ranked/unranked game found is fetched by sequence number (GetMatchDetails is broken).
// 3. Public players who keep showing up on a manual player's team are added as party mates.
//    Their games with the team are already stored by then.
import type { SyncStatus } from "../shared/types.ts";
import { config } from "./config.ts";
import { all, get, run, transaction } from "./db.ts";
import { ANONYMOUS_ACCOUNT_ID } from "./ids.ts";
import { inferPositions, learnHeroPriors, type HeroPriors } from "./roles.ts";
import { getHeroDetails, getHeroes, getMatchBySeqNum, getMatchHistory, type MatchDetail } from "./steam.ts";
import { addPartyMates, listTeams, listTrackedPlayers, refreshProNames, refreshProfiles } from "./team.ts";

const HISTORY_PRIVATE = 15;
const MAX_FETCH_ATTEMPTS = 3;

const status: SyncStatus = {
  running: false,
  teamId: null,
  phase: "idle",
  done: 0,
  total: 0,
  message: "",
  startedAt: null,
  finishedAt: null,
  error: null,
  newMatches: 0,
};

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

let listener: ((s: SyncStatus) => void) | null = null;
export function onSyncProgress(fn: (s: SyncStatus) => void) {
  listener = fn;
}

function report(phase: string, message: string, done = 0, total = 0) {
  Object.assign(status, { phase, message, done, total });
  listener?.(getSyncStatus());
}

/** Starts a sync unless one is already running. Resolves when it finishes. */
export function startSync(): Promise<SyncStatus> | null {
  if (status.running) return null;
  Object.assign(status, { running: true, startedAt: Date.now(), finishedAt: null, error: null, newMatches: 0 });
  return runSync()
    .catch((err: unknown) => {
      status.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      Object.assign(status, { running: false, finishedAt: Date.now() });
      report(status.error ? "error" : "done", status.error ?? `Added ${status.newMatches} new matches`);
    })
    .then(getSyncStatus);
}

async function runSync() {
  report("heroes", "Updating hero list");
  await syncHeroes();

  const tracked = listTrackedPlayers();
  if (tracked.length === 0) throw new Error("Add a player first.");

  report("profiles", "Updating Steam profiles");
  await refreshProfiles();
  await refreshProNames();

  for (const [i, player] of tracked.entries()) {
    report("history", `Reading match history for ${player.name}`, i, tracked.length);
    await syncHistory(player.accountId);
  }

  const pending = pendingMatches();
  for (const [i, m] of pending.entries()) {
    report("matches", `Fetching match ${m.match_id}`, i, pending.length);
    await fetchMatch(m.match_id, m.match_seq_num);
  }

  recomputePositions();

  for (const team of listTeams()) {
    report("party", `Looking for ${team.name}'s party mates`);
    const candidates = findPartyMates(team.id);
    if (candidates.length > 0) {
      const added = await addPartyMates(team.id, candidates);
      report("party", `Added ${added.length} party mates for ${team.name}`);
    }
  }
  await refreshProNames();
}

/**
 * The Web API has no party data, but anonymous players show up as 4294967295, so every
 * visible account ID belongs to a public player. Someone who keeps landing on a manual
 * player's team, and rarely against them, is a party mate; random players split roughly evenly.
 */
function findPartyMates(teamId: number) {
  const lobbies = config.lobbyTypes.join(",");
  return all<{ accountId: number; withGames: number }>(
    `SELECT mp.account_id AS accountId,
            COUNT(DISTINCT CASE WHEN mp.is_radiant = me.is_radiant THEN mp.match_id END) AS withGames,
            COUNT(DISTINCT CASE WHEN mp.is_radiant != me.is_radiant THEN mp.match_id END) AS againstGames
     FROM match_players me
     JOIN team_members t ON t.account_id = me.account_id AND t.team_id = :teamId AND t.source = 'manual'
     JOIN matches m ON m.match_id = me.match_id AND m.lobby_type IN (${lobbies})
     JOIN match_players mp ON mp.match_id = me.match_id AND mp.player_slot != me.player_slot
     WHERE mp.account_id IS NOT NULL
       AND mp.account_id NOT IN (SELECT account_id FROM team_members WHERE team_id = :teamId)
       AND mp.account_id NOT IN (SELECT account_id FROM ignored_players WHERE team_id = :teamId)
     GROUP BY mp.account_id
     HAVING withGames >= :minGames AND withGames >= 3 * againstGames
     ORDER BY withGames DESC`,
    { teamId, minGames: config.partyMinGames },
  );
}

async function syncHeroes() {
  const heroes = await getHeroes();
  transaction(() => {
    for (const h of heroes) {
      run(
        `INSERT INTO heroes (id, name, localized_name) VALUES (:id, :name, :localized)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, localized_name = excluded.localized_name`,
        { id: h.id, name: h.name.replace("npc_dota_hero_", ""), localized: h.localized_name },
      );
    }
  });

  // Role tags and attack type only change with new heroes, so fetch them once per hero.
  const missing = all<{ id: number; localized_name: string }>(
    "SELECT id, localized_name FROM heroes WHERE role_levels IS NULL ORDER BY id",
  );
  for (const [i, h] of missing.entries()) {
    report("heroes", `Reading hero roles for ${h.localized_name}`, i, missing.length);
    const details = await getHeroDetails(h.id).catch(() => null);
    if (!details) continue;
    run(
      "UPDATE heroes SET primary_attr = :attr, attack_capability = :attack, role_levels = :roles WHERE id = :id",
      {
        id: h.id,
        attr: details.primary_attr,
        attack: details.attack_capability,
        roles: JSON.stringify(details.role_levels),
      },
    );
  }
}

let heroPriors: HeroPriors = new Map();

/**
 * Re-learns hero position tendencies from every stored match, then re-infers every player's
 * position with them. Runs on startup and after each sync; ~1,000 matches take well under a second.
 */
export function recomputePositions() {
  const rows = all<{ match_id: number; raw: string }>("SELECT match_id, raw FROM matches");
  const matches = rows.map((r) => ({ matchId: r.match_id, ...(JSON.parse(r.raw) as MatchDetail) }));
  heroPriors = learnHeroPriors(matches);
  transaction(() => {
    for (const match of matches) {
      for (const [slot, position] of inferPositions(match.players, heroPriors)) {
        run("UPDATE match_players SET position = :position WHERE match_id = :matchId AND player_slot = :slot", {
          matchId: match.matchId,
          slot,
          position,
        });
      }
    }
  });
  return matches.length;
}

async function syncHistory(accountId: number) {
  const member = get<{ history_complete: number }>(
    "SELECT MAX(history_complete) AS history_complete FROM team_members WHERE account_id = :accountId",
    { accountId },
  );
  const incremental = member?.history_complete === 1;
  let startAt: number | undefined;

  for (;;) {
    const result = await getMatchHistory(accountId, startAt);
    if (result.status === HISTORY_PRIVATE) {
      setHistoryStatus(accountId, "private");
      return;
    }
    if (result.status !== 1) {
      setHistoryStatus(accountId, "error");
      return;
    }

    const matches = result.matches ?? [];
    let reachedKnown = false;
    transaction(() => {
      for (const m of matches) {
        const me = m.players.find((p) => p.account_id === accountId);
        if (!me) continue;
        const inserted = run(
          `INSERT INTO history (account_id, match_id, match_seq_num, start_time, lobby_type, is_radiant, hero_id)
           VALUES (:accountId, :matchId, :seq, :start, :lobby, :radiant, :hero)
           ON CONFLICT DO NOTHING`,
          {
            accountId,
            matchId: m.match_id,
            seq: m.match_seq_num,
            start: m.start_time,
            lobby: m.lobby_type,
            radiant: me.player_slot < 128 ? 1 : 0,
            hero: me.hero_id,
          },
        );
        if (inserted.changes === 0) reachedKnown = true;
      }
    });

    const done = matches.length === 0 || !result.results_remaining;
    if (done) {
      run("UPDATE team_members SET history_complete = 1 WHERE account_id = :accountId", { accountId });
    }
    if (done || (incremental && reachedKnown)) break;
    startAt = matches[matches.length - 1].match_id - 1;
  }
  setHistoryStatus(accountId, "ok");
}

function setHistoryStatus(accountId: number, historyStatus: string) {
  run(
    "UPDATE team_members SET history_status = :historyStatus, last_synced_at = :now WHERE account_id = :accountId",
    { accountId, historyStatus, now: Date.now() },
  );
}

function pendingMatches() {
  const lobbies = config.lobbyTypes.join(",");
  return all<{ match_id: number; match_seq_num: number }>(
    `SELECT h.match_id, MAX(h.match_seq_num) AS match_seq_num
     FROM history h
     JOIN team_members t ON t.account_id = h.account_id
     WHERE h.lobby_type IN (${lobbies})
       AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.match_id = h.match_id)
       AND NOT EXISTS (SELECT 1 FROM failed_matches f WHERE f.match_id = h.match_id AND f.attempts >= :maxAttempts)
     GROUP BY h.match_id
     HAVING SUM(t.source = 'manual') > 0
     ORDER BY MAX(h.start_time) DESC`,
    { maxAttempts: MAX_FETCH_ATTEMPTS },
  );
}

async function fetchMatch(matchId: number, seqNum: number) {
  let match: MatchDetail | null = null;
  try {
    match = await getMatchBySeqNum(seqNum);
  } catch (err) {
    recordFailure(matchId, err instanceof Error ? err.message : String(err));
    return;
  }
  if (!match || match.match_id !== matchId) {
    recordFailure(matchId, "Match not returned by the sequence endpoint");
    return;
  }
  saveMatch(match);
  status.newMatches++;
}

function recordFailure(matchId: number, reason: string) {
  run(
    `INSERT INTO failed_matches (match_id, reason, attempts, last_attempt_at) VALUES (:matchId, :reason, 1, :now)
     ON CONFLICT (match_id) DO UPDATE SET reason = excluded.reason, attempts = attempts + 1, last_attempt_at = excluded.last_attempt_at`,
    { matchId, reason, now: Date.now() },
  );
}

function saveMatch(m: MatchDetail) {
  transaction(() => {
    run(
      `INSERT OR REPLACE INTO matches (match_id, match_seq_num, start_time, duration, radiant_win, lobby_type, game_mode,
         radiant_score, dire_score, first_blood_time, human_players, raw)
       VALUES (:matchId, :seq, :start, :duration, :radiantWin, :lobby, :mode, :radiantScore, :direScore, :firstBlood, :humans, :raw)`,
      {
        matchId: m.match_id,
        seq: m.match_seq_num,
        start: m.start_time,
        duration: m.duration,
        radiantWin: m.radiant_win ? 1 : 0,
        lobby: m.lobby_type,
        mode: m.game_mode,
        radiantScore: m.radiant_score ?? null,
        direScore: m.dire_score ?? null,
        firstBlood: m.first_blood_time ?? null,
        humans: m.human_players ?? null,
        raw: JSON.stringify(m),
      },
    );
    const positions = inferPositions(m.players, heroPriors);
    for (const p of m.players) {
      run(
        `INSERT OR REPLACE INTO match_players (match_id, player_slot, account_id, is_radiant, hero_id, kills, deaths, assists,
           last_hits, denies, gold_per_min, xp_per_min, level, net_worth, hero_damage, tower_damage, hero_healing, leaver_status, position)
         VALUES (:matchId, :slot, :accountId, :radiant, :hero, :kills, :deaths, :assists, :lastHits, :denies, :gpm, :xpm,
           :level, :netWorth, :heroDamage, :towerDamage, :healing, :leaver, :position)`,
        {
          matchId: m.match_id,
          slot: p.player_slot,
          accountId: p.account_id === undefined || p.account_id === ANONYMOUS_ACCOUNT_ID ? null : p.account_id,
          radiant: p.player_slot < 128 ? 1 : 0,
          hero: p.hero_id,
          kills: p.kills ?? null,
          deaths: p.deaths ?? null,
          assists: p.assists ?? null,
          lastHits: p.last_hits ?? null,
          denies: p.denies ?? null,
          gpm: p.gold_per_min ?? null,
          xpm: p.xp_per_min ?? null,
          level: p.level ?? null,
          netWorth: p.net_worth ?? null,
          heroDamage: p.hero_damage ?? null,
          towerDamage: p.tower_damage ?? null,
          healing: p.hero_healing ?? null,
          leaver: p.leaver_status ?? null,
          position: positions.get(p.player_slot) ?? null,
        },
      );
    }
    run("DELETE FROM failed_matches WHERE match_id = :matchId", { matchId: m.match_id });
  });
}
