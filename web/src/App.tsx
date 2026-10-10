import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dashboard, Filters, Meta } from "../../shared/types.ts";
import { api } from "./api.ts";
import { Combos } from "./components/Combos.tsx";
import { Comfort } from "./components/Comfort.tsx";
import { Composition } from "./components/Composition.tsx";
import { DuoMatrix } from "./components/DuoMatrix.tsx";
import { Factors } from "./components/Factors.tsx";
import { FilterBar, defaultFilters } from "./components/FilterBar.tsx";
import { Header, type Theme } from "./components/Header.tsx";
import { HeroPool } from "./components/HeroPool.tsx";
import { Insights } from "./components/Insights.tsx";
import { Kpis } from "./components/Kpis.tsx";
import { Lineups } from "./components/Lineups.tsx";
import { Matchups } from "./components/Matchups.tsx";
import { OutcomeChart } from "./components/OutcomeChart.tsx";
import { Players } from "./components/Players.tsx";
import { RecentMatches } from "./components/RecentMatches.tsx";
import { Roles } from "./components/Roles.tsx";
import { TeamDialog } from "./components/TeamDialog.tsx";
import { TrendChart } from "./components/TrendChart.tsx";
import { Card, LookupProvider, TooltipProvider } from "./components/ui.tsx";

const FILTERS_KEY = "d2-team-stats:filters";
const THEME_KEY = "d2-team-stats:theme";
const TEAM_KEY = "d2-team-stats:team";

/** The view to open: ?team= in the URL wins, then the last one used. */
function initialTeam(): number | null {
  const fromUrl = Number.parseInt(new URLSearchParams(window.location.search).get("team") ?? "", 10);
  return Number.isFinite(fromUrl) ? fromUrl : load<number | null>(TEAM_KEY, null);
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode); filters just won't persist.
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function App() {
  const [teamId, setTeamId] = useState<number | null>(initialTeam);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters | null>(() => load<Filters | null>(FILTERS_KEY, null));
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => load<Theme>(THEME_KEY, "system"));
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    save(THEME_KEY, theme);
  }, [theme]);

  const refreshMeta = useCallback(async () => {
    try {
      const m = await api.meta(teamId);
      setMeta(m);
      setMetaError(null);
      if (m.team && m.team.id !== teamId) setTeamId(m.team.id);
    } catch (err) {
      setMetaError(message(err));
    }
  }, [teamId]);

  function switchTeam(id: number) {
    setTeamId(id);
    setData(null);
    save(TEAM_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set("team", String(id));
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  const members = useMemo(() => meta?.members ?? [], [meta]);
  const memberKey = members.map((m) => m.accountId).join(",");

  // Pick defaults once the team is known, reset per-player filters when switching views,
  // and drop a focused player who left the team.
  const currentTeam = meta?.team?.id ?? null;
  useEffect(() => {
    if (currentTeam === null) return;
    const defaults = defaultFilters(members.length, currentTeam);
    if (!filters) setFilters(defaults);
    else if (Object.keys(defaults).some((k) => !(k in filters))) setFilters({ ...defaults, ...filters, team: currentTeam });
    else if (filters.team !== currentTeam) setFilters({ ...filters, team: currentTeam, player: null, position: null });
    else if (filters.player !== null && !members.some((m) => m.accountId === filters.player)) {
      setFilters({ ...filters, player: null });
    }
  }, [currentTeam, members, filters]);

  useEffect(() => {
    if (!filters || !memberKey || filters.team !== currentTeam) return;
    save(FILTERS_KEY, filters);
    const ctrl = new AbortController();
    setLoading(true);
    api
      .dashboard(filters, ctrl.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setError(message(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [filters, memberKey, currentTeam, reloadKey]);

  // While a sync runs, poll its progress and refresh the numbers every ~15s.
  const syncing = meta?.sync.running ?? false;
  useEffect(() => {
    if (!syncing) return;
    let ticks = 0;
    const id = setInterval(async () => {
      const s = await api.syncStatus().catch(() => null);
      if (!s) return;
      setMeta((m) => (m ? { ...m, sync: s } : m));
      ticks++;
      if (!s.running || ticks % 10 === 0) {
        await refreshMeta();
        setReloadKey((k) => k + 1);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [syncing, refreshMeta]);

  async function startSync() {
    try {
      const s = await api.startSync();
      setMeta((m) => (m ? { ...m, sync: s } : m));
    } catch (err) {
      setMetaError(message(err));
    }
  }

  const lookup = useMemo(
    () => ({ members: new Map(members.map((m) => [m.accountId, m])), heroes: meta?.heroes ?? {} }),
    [members, meta?.heroes],
  );
  const sync = meta?.sync;
  const privateMembers = members.filter((m) => m.historyStatus === "private");
  const focused = filters?.player ? (lookup.members.get(filters.player)?.name ?? null) : null;

  return (
    <LookupProvider value={lookup}>
      <TooltipProvider>
        <div className="shell">
          <Header
            meta={meta}
            onSwitchTeam={switchTeam}
            theme={theme}
            onTheme={setTheme}
            onSync={startSync}
            onManageTeam={() => setTeamOpen(true)}
          />

          {metaError && (
            <div className="banner" role="alert">
              Can't reach the API: {metaError}. Is <code>pnpm dev</code> running?
            </div>
          )}
          {sync?.running && (
            <div className="banner" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>
                {sync.message}
                {sync.total ? ` · ${sync.done} of ${sync.total}` : ""}
              </span>
              {sync.total > 0 && (
                <div className="progress" aria-hidden="true">
                  <div style={{ width: `${(sync.done / sync.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {sync?.error && !sync.running && (
            <div className="banner" role="alert">
              Last sync failed: {sync.error}
            </div>
          )}
          {privateMembers.length > 0 && (
            <div className="banner">
              <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2 1 21h22L12 2zm1 15h-2v2h2v-2zm0-7h-2v5h2v-5z" />
              </svg>
              <span>
                <strong>{privateMembers.map((m) => m.name).join(", ")}</strong>{" "}
                {privateMembers.length === 1 ? "has" : "have"} match data set to private. Turn on{" "}
                <strong>Expose Public Match Data</strong> in Dota 2 settings, then sync again.
              </span>
            </div>
          )}

          {meta && members.length === 0 ? (
            <section className="card empty" style={{ marginTop: 16 }}>
              <h2>Track a player</h2>
              <p>
                Add a player by Dota friend ID, SteamID or Steam profile link. Their ranked and unranked games are pulled
                from the Steam Web API, and the people they party with are added automatically.
              </p>
              <button type="button" className="btn primary" onClick={() => setTeamOpen(true)}>
                Add a player
              </button>
            </section>
          ) : (
            filters &&
            meta && (
              <>
                <FilterBar filters={filters} members={members} onChange={setFilters} />
                {error && (
                  <div className="banner" role="alert">
                    Couldn't load stats: {error}
                  </div>
                )}
                {meta.storedMatches === 0 && !sync?.running ? (
                  <section className="card empty" style={{ marginTop: 16 }}>
                    <h2>No games yet</h2>
                    <p>Sync to pull everyone's recent ranked and unranked games. The first sync takes a few minutes.</p>
                    <button type="button" className="btn primary" onClick={startSync}>
                      Sync matches
                    </button>
                  </section>
                ) : (
                  data && (
                    <div className="loading-frame" data-loading={loading}>
                      <Kpis data={data} />
                      <div className="grid">
                        <Insights insights={data.insights} />
                      </div>
                      <div className="grid">
                        <Players
                          members={members}
                          players={data.players}
                          roles={data.roles}
                          selected={filters.player}
                          onSelect={(player) => setFilters({ ...filters, player })}
                        />
                      </div>
                      <div className="grid two">
                        <Roles
                          members={members}
                          roles={data.roles}
                          onFocus={(player, position) => setFilters({ ...filters, player, position })}
                        />
                        <Lineups lineups={data.lineups} />
                      </div>
                      <div className="grid">
                        <HeroPool heroes={data.heroes} focusedPlayer={focused} />
                      </div>
                      <div className="grid two">
                        <Combos combos={data.combos} min={filters.min} />
                        <DuoMatrix members={members} duos={data.duos} players={data.players} min={filters.min} />
                      </div>
                      <div className="grid">
                        <Matchups matchups={data.matchups} min={filters.min} />
                      </div>
                      <div className="grid">
                        <Factors factors={data.factors} members={members} />
                      </div>
                      <div className="grid">
                        <Comfort comfort={data.comfort} />
                      </div>
                      <div className="grid">
                        <Composition composition={data.composition} />
                      </div>
                      <div className="grid">
                        <Card title="When we win" subtitle="Win rate against a 50% baseline">
                          <div className="split">
                            <OutcomeChart title="By game length" data={data.byLength} />
                            <OutcomeChart title="By party size" data={data.byStack} />
                          </div>
                        </Card>
                      </div>
                      <div className="grid">
                        <Card
                          title="Sessions and timing"
                          subtitle="A session is a run of games with less than 2 hours between them · times are local to the server"
                        >
                          <div className="chart-grid">
                            <OutcomeChart title="Game number in the session" data={data.sessions.byGameNumber} />
                            <OutcomeChart title="Previous game" data={data.sessions.afterResult} />
                            <OutcomeChart title="Time of day" data={data.sessions.byTimeOfDay} />
                            <OutcomeChart title="Day of week" data={data.sessions.byWeekday} />
                          </div>
                        </Card>
                      </div>
                      <div className="grid">
                        <TrendChart points={data.trend} />
                      </div>
                      <div className="grid">
                        <RecentMatches matches={data.recent} />
                      </div>
                    </div>
                  )
                )}
              </>
            )
          )}

          <p className="footer-note">
            Data from the Steam Web API. Valve only returns each player's 500 most recent games, so keep syncing to
            build up history.
          </p>
        </div>

        <TeamDialog
          open={teamOpen}
          team={meta?.team ?? null}
          canDeleteTeam={(meta?.teams.length ?? 0) > 1}
          members={members}
          onClose={() => setTeamOpen(false)}
          onChanged={() => {
            refreshMeta();
            setReloadKey((k) => k + 1);
          }}
          onTeamCreated={(id) => {
            setTeamOpen(false);
            switchTeam(id);
          }}
          onTeamDeleted={() => {
            setTeamOpen(false);
            const next = meta?.teams.find((t) => t.id !== meta?.team?.id);
            if (next) switchTeam(next.id);
          }}
        />
      </TooltipProvider>
    </LookupProvider>
  );
}
