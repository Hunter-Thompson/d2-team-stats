import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { Hero, Meta } from "../shared/types.ts";
import { config } from "./config.ts";
import { TEAM_CTES, all, get } from "./db.ts";
import { dashboard, parseFilters, sections } from "./stats.ts";
import { getSyncStatus, recomputePositions, startSync } from "./sync.ts";
import { addMember, createTeam, deleteTeam, listMembers, listTeams, removeMember, resolveTeamId } from "./team.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

function meta(teamId: number | null): Meta {
  const heroes: Record<number, Hero> = {};
  for (const h of all<{ id: number; name: string; localized_name: string }>("SELECT * FROM heroes")) {
    heroes[h.id] = { id: h.id, name: h.name, localizedName: h.localized_name };
  }
  const teams = listTeams();
  return {
    team: teams.find((t) => t.id === teamId) ?? null,
    teams,
    members: teamId === null ? [] : listMembers(teamId),
    heroes,
    sync: getSyncStatus(),
    storedMatches:
      teamId === null
        ? 0
        : (get<{ n: number }>(`WITH ${TEAM_CTES} SELECT COUNT(*) AS n FROM team_matches`, { team: teamId })?.n ?? 0),
  };
}

const badRequest = (err: unknown) => new HttpError(400, err instanceof Error ? err.message : String(err));

async function inputFrom(req: IncomingMessage) {
  const body = await readJson(req);
  if (typeof body.input !== "string") throw new HttpError(400, "Expected { input: string }");
  return body.input;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname}`;
  // Every team-scoped endpoint takes ?team=<id>; without it, the first team is used.
  const teamId = resolveTeamId(Number.parseInt(url.searchParams.get("team") ?? "", 10) || null);
  const requireTeam = () => {
    if (teamId === null) throw new HttpError(404, "No players are tracked yet");
    return teamId;
  };

  if (route === "GET /api/meta") return sendJson(res, 200, meta(teamId));

  if (route === "GET /api/dashboard" || url.pathname.startsWith("/api/stats/")) {
    const filters = parseFilters(url.searchParams);
    if (!filters) throw new HttpError(404, "No players are tracked yet");
    if (route === "GET /api/dashboard") return sendJson(res, 200, dashboard(filters));
    const section = url.pathname.match(/^\/api\/stats\/(\w+)$/)?.[1];
    if (req.method === "GET" && section && Object.hasOwn(sections, section)) {
      return sendJson(res, 200, sections[section as keyof typeof sections](filters));
    }
  }

  // Teams: one per tracked player.
  if (route === "GET /api/teams") return sendJson(res, 200, listTeams());
  if (route === "POST /api/teams") {
    const input = await inputFrom(req);
    try {
      const team = await createTeam(input);
      startSync();
      return sendJson(res, 201, team);
    } catch (err) {
      throw badRequest(err);
    }
  }
  const deleteTeamId = url.pathname.match(/^\/api\/teams\/(\d+)$/)?.[1];
  if (req.method === "DELETE" && deleteTeamId) {
    deleteTeam(Number(deleteTeamId));
    return sendJson(res, 200, listTeams());
  }

  // Members of the selected team.
  if (route === "GET /api/team") return sendJson(res, 200, listMembers(requireTeam()));
  if (route === "POST /api/team") {
    const input = await inputFrom(req);
    try {
      return sendJson(res, 201, await addMember(requireTeam(), input));
    } catch (err) {
      throw badRequest(err);
    }
  }
  const removeId = url.pathname.match(/^\/api\/team\/(\d+)$/)?.[1];
  if (req.method === "DELETE" && removeId) {
    removeMember(requireTeam(), Number(removeId));
    return sendJson(res, 200, listMembers(requireTeam()));
  }

  if (route === "GET /api/sync") return sendJson(res, 200, getSyncStatus());
  if (route === "POST /api/sync") {
    startSync();
    return sendJson(res, 202, getSyncStatus());
  }

  throw new HttpError(404, "Not found");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(res: ServerResponse, url: URL) {
  const index = path.join(config.distDir, "index.html");
  if (!fs.existsSync(index)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dashboard not built. Run `pnpm build`, or use `pnpm dev` and open http://localhost:5173.");
    return;
  }
  const requested = path.normalize(path.join(config.distDir, decodeURIComponent(url.pathname)));
  const file =
    requested.startsWith(config.distDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : index;
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const positioned = recomputePositions();
if (positioned) console.log(`Inferred positions for ${positioned} stored matches`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err instanceof Error ? err.message : "Internal error" });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});
