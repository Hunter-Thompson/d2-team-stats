import type { Dashboard, Filters, Member, Meta, SyncStatus, Team } from "../../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function filtersToQuery(f: Filters) {
  const sp = new URLSearchParams({
    team: String(f.team),
    days: String(f.days),
    queue: f.queue,
    mode: f.mode,
    stack: String(f.stack),
    min: String(f.min),
    abandons: f.abandons,
  });
  if (f.player !== null) sp.set("player", String(f.player));
  if (f.position !== null) sp.set("position", String(f.position));
  return sp.toString();
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  meta: (team: number | null) => request<Meta>(team === null ? "/api/meta" : `/api/meta?team=${team}`),
  dashboard: (f: Filters, signal?: AbortSignal) => request<Dashboard>(`/api/dashboard?${filtersToQuery(f)}`, { signal }),
  syncStatus: () => request<SyncStatus>("/api/sync"),
  startSync: () => request<SyncStatus>("/api/sync", { method: "POST" }),
  addMember: (team: number, input: string) => request<Member>(`/api/team?team=${team}`, json({ input })),
  removeMember: (team: number, accountId: number) =>
    request<Member[]>(`/api/team/${accountId}?team=${team}`, { method: "DELETE" }),
  createTeam: (input: string) => request<Team>("/api/teams", json({ input })),
  deleteTeam: (team: number) => request<Team[]>(`/api/teams/${team}`, { method: "DELETE" }),
};
