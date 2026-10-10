import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.ts";

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

// The timeout lets the server and `pnpm sync` share the file without "database is locked" errors.
export const db = new DatabaseSync(config.dbFile, { timeout: 10_000 });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS heroes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,            -- e.g. "zuus" (npc_dota_hero_ prefix stripped)
    localized_name TEXT NOT NULL   -- e.g. "Zeus"
  );

  -- A team is one tracked player's view: that player plus the party mates found for them.
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,            -- the tracked player's pro name or Steam name
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    steam_id TEXT NOT NULL,
    persona_name TEXT,
    avatar_url TEXT,
    profile_url TEXT,
    color_slot INTEGER NOT NULL,   -- fixed chart color (1-8, 0 = neutral), so it never changes
    history_status TEXT NOT NULL DEFAULT 'pending',  -- pending | ok | private | error
    history_complete INTEGER NOT NULL DEFAULT 0,     -- 1 once the full 500-match backfill finished
    last_synced_at INTEGER,
    added_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',           -- manual | auto (detected party mate)
    note TEXT,                                       -- why a party mate was added
    PRIMARY KEY (team_id, account_id)
  );

  -- Players removed from a team, so party detection doesn't add them back.
  CREATE TABLE IF NOT EXISTS ignored_players (
    team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    removed_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, account_id)
  );

  -- One row per (member, match) from GetMatchHistory. Used to find team games to fetch.
  CREATE TABLE IF NOT EXISTS history (
    account_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    match_seq_num INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    lobby_type INTEGER NOT NULL,
    is_radiant INTEGER NOT NULL,
    hero_id INTEGER NOT NULL,
    PRIMARY KEY (account_id, match_id)
  );
  CREATE INDEX IF NOT EXISTS history_match ON history (match_id);

  CREATE TABLE IF NOT EXISTS matches (
    match_id INTEGER PRIMARY KEY,
    match_seq_num INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    radiant_win INTEGER NOT NULL,
    lobby_type INTEGER NOT NULL,
    game_mode INTEGER NOT NULL,
    radiant_score INTEGER,
    dire_score INTEGER,
    first_blood_time INTEGER,
    human_players INTEGER,
    raw TEXT NOT NULL              -- full API payload, so new stats can be backfilled later
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
    player_slot INTEGER NOT NULL,
    account_id INTEGER,            -- NULL for anonymous players
    is_radiant INTEGER NOT NULL,
    hero_id INTEGER NOT NULL,
    kills INTEGER, deaths INTEGER, assists INTEGER,
    last_hits INTEGER, denies INTEGER,
    gold_per_min INTEGER, xp_per_min INTEGER,
    level INTEGER, net_worth INTEGER,
    hero_damage INTEGER, tower_damage INTEGER, hero_healing INTEGER,
    leaver_status INTEGER,
    PRIMARY KEY (match_id, player_slot)
  );
  CREATE INDEX IF NOT EXISTS match_players_account ON match_players (account_id);

  CREATE TABLE IF NOT EXISTS failed_matches (
    match_id INTEGER PRIMARY KEY,
    reason TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    last_attempt_at INTEGER NOT NULL
  );

`);

// Older databases: columns added later, and the move from one global team to one per player.
const columnsOf = (table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
function addColumn(table: string, column: string, definition: string) {
  if (!columnsOf(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("match_players", "position", "INTEGER"); // inferred 1-5, see roles.ts
addColumn("heroes", "primary_attr", "INTEGER"); // 0 str, 1 agi, 2 int, 3 universal
addColumn("heroes", "attack_capability", "INTEGER"); // 1 melee, 2 ranged
addColumn("heroes", "role_levels", "TEXT"); // JSON array, indexed like HERO_ROLES

db.exec("DROP VIEW IF EXISTS v_team_matches; DROP VIEW IF EXISTS v_match_sides;");

if (!columnsOf("team_members").includes("team_id")) {
  addColumn("team_members", "source", "TEXT NOT NULL DEFAULT 'manual'");
  addColumn("team_members", "note", "TEXT");
  db.exec("BEGIN");
  try {
    const first = db
      .prepare("SELECT persona_name FROM team_members WHERE source = 'manual' ORDER BY added_at LIMIT 1")
      .get() as { persona_name: string | null } | undefined;
    if (first) {
      db.prepare("INSERT INTO teams (id, name, created_at) VALUES (1, ?, ?)").run(first.persona_name ?? "My team", Date.now());
    }
    db.exec(`
      ALTER TABLE team_members RENAME TO team_members_old;
      ALTER TABLE ignored_players RENAME TO ignored_players_old;
      CREATE TABLE team_members (
        team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL, steam_id TEXT NOT NULL, persona_name TEXT, avatar_url TEXT, profile_url TEXT,
        color_slot INTEGER NOT NULL, history_status TEXT NOT NULL DEFAULT 'pending',
        history_complete INTEGER NOT NULL DEFAULT 0, last_synced_at INTEGER, added_at INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual', note TEXT,
        PRIMARY KEY (team_id, account_id)
      );
      CREATE TABLE ignored_players (
        team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL, removed_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, account_id)
      );
      INSERT INTO team_members SELECT 1, account_id, steam_id, persona_name, avatar_url, profile_url, color_slot,
        history_status, history_complete, last_synced_at, added_at, source, note FROM team_members_old;
      INSERT INTO ignored_players SELECT 1, account_id, removed_at FROM ignored_players_old;
      DROP TABLE team_members_old;
      DROP TABLE ignored_players_old;
    `);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Registered pro name from Valve's esports data; '' once checked and the player isn't a pro.
addColumn("team_members", "pro_name", "TEXT");

/**
 * CTEs for one team's games (bind :team). "Manual" members are the players a team is built
 * around; party mates only count in games played with one of them.
 *   members:      the team's players
 *   team_matches: games with a manual member, from their side: we_radiant, stack (members on
 *                 our side) and won
 */
export const TEAM_CTES = `
  members AS (SELECT * FROM team_members WHERE team_id = :team),
  match_sides AS (
    SELECT mp.match_id,
           SUM(mp.is_radiant) AS radiant_members,
           SUM(1 - mp.is_radiant) AS dire_members,
           SUM(t.source = 'manual' AND mp.is_radiant = 1) AS radiant_manual,
           SUM(t.source = 'manual' AND mp.is_radiant = 0) AS dire_manual
    FROM match_players mp
    JOIN members t ON t.account_id = mp.account_id
    GROUP BY mp.match_id
  ),
  sided AS (
    SELECT m.*, s.radiant_members, s.dire_members,
           CASE
             WHEN s.radiant_manual != s.dire_manual THEN s.radiant_manual > s.dire_manual
             ELSE s.radiant_members >= s.dire_members
           END AS we_radiant
    FROM matches m
    JOIN match_sides s ON s.match_id = m.match_id
    WHERE s.radiant_manual + s.dire_manual > 0
  ),
  team_matches AS (
    SELECT match_id, start_time, duration, lobby_type, game_mode, radiant_score, dire_score, we_radiant,
           CASE WHEN we_radiant THEN radiant_members ELSE dire_members END AS stack,
           (we_radiant = radiant_win) AS won
    FROM sided
  )
`;

type Params = Record<string, SQLInputValue>;

function prepare(sql: string) {
  const stmt = db.prepare(sql);
  stmt.setAllowUnknownNamedParameters(true);
  return stmt;
}

export function all<T>(sql: string, params: Params = {}) {
  return prepare(sql).all(params) as T[];
}

export function get<T>(sql: string, params: Params = {}) {
  return prepare(sql).get(params) as T | undefined;
}

export function run(sql: string, params: Params = {}) {
  return prepare(sql).run(params);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
