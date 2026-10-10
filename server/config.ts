import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env file; rely on the real environment.
}

export const config = {
  root,
  steamApiKey: process.env.STEAM_API_KEY ?? "",
  dbFile: process.env.DB_FILE ?? path.join(root, "data", "stats.db"),
  distDir: path.join(root, "dist"),
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
  // A public player becomes an auto-added party mate after this many games on the same side as a
  // manually added player (and at most a third as many games against them).
  partyMinGames: Number(process.env.PARTY_MIN_GAMES ?? 3),
  // 0 = unranked matchmaking (incl. Turbo), 7 = ranked matchmaking.
  lobbyTypes: [0, 7],
  // Distinct player colors; players past this share a neutral color.
  colorSlots: 8,
};
