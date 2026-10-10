import type { HistoryStatus, Member, Team } from "../shared/types.ts";
import { config } from "./config.ts";
import { all, get, run, transaction } from "./db.ts";
import { resolvePlayerInput, toSteam64 } from "./ids.ts";
import { getPlayerSummaries, getProName, type PlayerSummary } from "./steam.ts";

interface MemberRow {
  account_id: number;
  steam_id: string;
  persona_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  color_slot: number;
  history_status: HistoryStatus;
  last_synced_at: number | null;
  source: "manual" | "auto";
  note: string | null;
  pro_name: string | null;
}

function toMember(row: MemberRow): Member {
  return {
    accountId: row.account_id,
    steamId: row.steam_id,
    name: row.pro_name || row.persona_name || String(row.account_id),
    avatarUrl: row.avatar_url,
    profileUrl: row.profile_url,
    colorSlot: row.color_slot,
    historyStatus: row.history_status,
    lastSyncedAt: row.last_synced_at,
    source: row.source,
    note: row.note,
  };
}

// ---------- Teams (one per tracked player) ----------

export function listTeams(): Team[] {
  return all<Team>(
    `SELECT t.id, t.name,
            (SELECT m.account_id FROM team_members m WHERE m.team_id = t.id AND m.source = 'manual' ORDER BY m.added_at LIMIT 1) AS accountId,
            (SELECT m.avatar_url FROM team_members m WHERE m.team_id = t.id AND m.source = 'manual' ORDER BY m.added_at LIMIT 1) AS avatarUrl,
            (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS memberCount
     FROM teams t ORDER BY t.id`,
  );
}

export function resolveTeamId(requested: number | null) {
  if (requested !== null && get("SELECT 1 FROM teams WHERE id = :id", { id: requested })) return requested;
  return get<{ id: number }>("SELECT id FROM teams ORDER BY id LIMIT 1")?.id ?? null;
}

/** Starts tracking a player in a view of their own, named after their pro name if they have one. */
export async function createTeam(input: string) {
  const accountId = await resolvePlayerInput(input);
  const [summary] = await getPlayerSummaries([toSteam64(accountId)]);
  if (!summary) throw new Error(`No Steam profile found for account ${accountId}.`);
  const existing = get<{ team_id: number }>(
    "SELECT team_id FROM team_members WHERE account_id = :accountId AND source = 'manual' LIMIT 1",
    { accountId },
  );
  if (existing) throw new Error(`${summary.personaname} already has a view.`);

  const proName = await getProName(accountId).catch(() => null);
  const name = proName || summary.personaname;
  const teamId = transaction(() => {
    const id = Number(run("INSERT INTO teams (name, created_at) VALUES (:name, :now)", { name, now: Date.now() }).lastInsertRowid);
    insertMember(id, accountId, summary, "manual", null, proName);
    return id;
  });
  return listTeams().find((t) => t.id === teamId)!;
}

export function deleteTeam(teamId: number) {
  run("DELETE FROM teams WHERE id = :teamId", { teamId });
}

// ---------- Members of one team ----------

export function listMembers(teamId: number) {
  return all<MemberRow>(
    `SELECT * FROM team_members WHERE team_id = :teamId
     ORDER BY source = 'auto', color_slot = 0, color_slot, added_at`,
    { teamId },
  ).map(toMember);
}

/** Every manually added player across all teams; their match histories drive syncing. */
export function listTrackedPlayers() {
  return all<{ account_id: number; name: string | null }>(
    `SELECT account_id, MAX(COALESCE(NULLIF(pro_name, ''), persona_name)) AS name
     FROM team_members WHERE source = 'manual' GROUP BY account_id`,
  ).map((r) => ({ accountId: r.account_id, name: r.name ?? String(r.account_id) }));
}

function nextColorSlot(teamId: number) {
  const used = new Set(
    all<{ color_slot: number }>("SELECT color_slot FROM team_members WHERE team_id = :teamId", { teamId }).map(
      (r) => r.color_slot,
    ),
  );
  for (let slot = 1; slot <= config.colorSlots; slot++) if (!used.has(slot)) return slot;
  return 0;
}

function insertMember(
  teamId: number,
  accountId: number,
  summary: PlayerSummary,
  source: "manual" | "auto",
  note: string | null,
  proName: string | null = null,
) {
  run(
    `INSERT INTO team_members (team_id, account_id, steam_id, persona_name, avatar_url, profile_url, color_slot,
       added_at, source, note, pro_name)
     VALUES (:teamId, :accountId, :steamId, :name, :avatar, :profile, :slot, :now, :source, :note, :proName)`,
    {
      teamId,
      accountId,
      steamId: summary.steamid,
      name: summary.personaname,
      avatar: summary.avatarmedium,
      profile: summary.profileurl,
      slot: nextColorSlot(teamId),
      now: Date.now(),
      source,
      note,
      proName,
    },
  );
}

export async function addMember(teamId: number, input: string) {
  const accountId = await resolvePlayerInput(input);
  const existing = get<{ source: string }>(
    "SELECT source FROM team_members WHERE team_id = :teamId AND account_id = :accountId",
    { teamId, accountId },
  );
  if (existing?.source === "manual") throw new Error("That player is already on the team.");
  if (existing) {
    // Promote a detected party mate so all of their games get fetched.
    run("UPDATE team_members SET source = 'manual', note = NULL WHERE team_id = :teamId AND account_id = :accountId", {
      teamId,
      accountId,
    });
  } else {
    const [summary] = await getPlayerSummaries([toSteam64(accountId)]);
    if (!summary) throw new Error(`No Steam profile found for account ${accountId}.`);
    insertMember(teamId, accountId, summary, "manual", null);
  }
  run("DELETE FROM ignored_players WHERE team_id = :teamId AND account_id = :accountId", { teamId, accountId });
  return listMembers(teamId).find((m) => m.accountId === accountId)!;
}

/** Adds detected party mates to a team. Returns the account IDs that were added. */
export async function addPartyMates(teamId: number, candidates: { accountId: number; withGames: number }[]) {
  const added: number[] = [];
  // GetPlayerSummaries takes up to 100 SteamIDs per call.
  for (let i = 0; i < candidates.length; i += 100) {
    const batch = candidates.slice(i, i + 100);
    const summaries = new Map(
      (await getPlayerSummaries(batch.map((c) => toSteam64(c.accountId)))).map((s) => [s.steamid, s]),
    );
    for (const c of batch) {
      const summary = summaries.get(toSteam64(c.accountId));
      if (!summary) continue;
      insertMember(teamId, c.accountId, summary, "auto", `Party mate · ${c.withGames} games together`);
      added.push(c.accountId);
    }
  }
  return added;
}

export function removeMember(teamId: number, accountId: number) {
  run("DELETE FROM team_members WHERE team_id = :teamId AND account_id = :accountId", { teamId, accountId });
  run(
    `INSERT INTO ignored_players (team_id, account_id, removed_at) VALUES (:teamId, :accountId, :now)
     ON CONFLICT (team_id, account_id) DO UPDATE SET removed_at = :now`,
    { teamId, accountId, now: Date.now() },
  );
}

/** Looks up Valve's registered pro names for players not checked yet. */
export async function refreshProNames() {
  const unchecked = all<{ account_id: number }>("SELECT DISTINCT account_id FROM team_members WHERE pro_name IS NULL");
  for (const { account_id: accountId } of unchecked) {
    const name = await getProName(accountId).catch(() => undefined);
    if (name === undefined) continue; // network error: try again next sync
    run("UPDATE team_members SET pro_name = :name WHERE account_id = :accountId", { name: name ?? "", accountId });
  }
}

export async function refreshProfiles() {
  const steamIds = all<{ steam_id: string }>("SELECT DISTINCT steam_id FROM team_members").map((r) => r.steam_id);
  for (let i = 0; i < steamIds.length; i += 100) {
    for (const s of await getPlayerSummaries(steamIds.slice(i, i + 100))) {
      run(
        "UPDATE team_members SET persona_name = :name, avatar_url = :avatar, profile_url = :profile WHERE steam_id = :steamId",
        { name: s.personaname, avatar: s.avatarmedium, profile: s.profileurl, steamId: s.steamid },
      );
    }
  }
}
