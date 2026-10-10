// Usage:
//   pnpm sync                          sync every tracked player and their party mates
//   pnpm sync track <player>           start tracking a player in a view of their own
//   pnpm sync add <player> [team id]   add a player to a view (default: the first one)
//   pnpm sync remove <id> [team id]    remove a player from a view
//   pnpm sync teams                    list views and their players
import { onSyncProgress, startSync } from "./sync.ts";
import { addMember, createTeam, listMembers, listTeams, removeMember, resolveTeamId } from "./team.ts";

const [command, arg, teamArg] = process.argv.slice(2);

function printTeams() {
  const teams = listTeams();
  if (teams.length === 0) console.log("No players yet. Start with: pnpm sync track <friend id | profile url>");
  for (const t of teams) {
    console.log(`#${t.id} ${t.name}`);
    for (const m of listMembers(t.id)) {
      console.log(`   ${String(m.accountId).padEnd(12)} ${m.name.padEnd(24)} ${m.source === "auto" ? "party mate" : m.historyStatus}`);
    }
  }
}

function teamFromArg() {
  const team = resolveTeamId(teamArg ? Number(teamArg) : null);
  if (team === null) throw new Error("No views yet. Start with: pnpm sync track <player>");
  return team;
}

async function main() {
  if (command === "track" && arg) {
    const team = await createTeam(arg);
    console.log(`Tracking ${team.name} (view #${team.id}). Run pnpm sync to fetch their games.`);
  } else if (command === "add" && arg) {
    const m = await addMember(teamFromArg(), arg);
    console.log(`Added ${m.name} (${m.accountId})`);
  } else if (command === "remove" && arg) {
    removeMember(teamFromArg(), Number(arg));
    printTeams();
  } else if (command === "teams") {
    printTeams();
  } else if (!command) {
    let lastLine = "";
    onSyncProgress((s) => {
      const line = s.total ? `[${s.phase}] ${s.message} (${s.done + 1}/${s.total})` : `[${s.phase}] ${s.message}`;
      if (line !== lastLine) console.log(line);
      lastLine = line;
    });
    const result = await startSync();
    printTeams();
    if (result?.error) process.exitCode = 1;
  } else {
    console.error("Usage: pnpm sync [track <player> | add <player> [team] | remove <id> [team] | teams]");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
