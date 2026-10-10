import type { Meta } from "../../../shared/types.ts";
import { timeAgo } from "../format.ts";

export type Theme = "system" | "light" | "dark";

const THEME_LABEL: Record<Theme, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light")
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function Header({
  meta,
  onSwitchTeam,
  theme,
  onTheme,
  onSync,
  onManageTeam,
}: {
  meta: Meta | null;
  onSwitchTeam: (teamId: number) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onSync: () => void;
  onManageTeam: () => void;
}) {
  const sync = meta?.sync;
  const lastSynced = meta?.members.reduce<number | null>(
    (latest, m) => (m.lastSyncedAt && (!latest || m.lastSyncedAt > latest) ? m.lastSyncedAt : latest),
    null,
  );
  const nextTheme: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";

  return (
    <header className="header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 36 36" aria-hidden="true">
          <rect width="36" height="36" rx="9" fill="var(--surface-2)" stroke="var(--border)" />
          <path d="M10 25 L10 11 L14 11 L18 17 L22 11 L26 11 L26 25 L22 25 L22 18 L18 23 L14 18 L14 25 Z" fill="var(--neg)" />
        </svg>
        <div>
          <h1>Team Stats</h1>
          <p>
            {meta ? `${meta.storedMatches} games tracked` : "Loading…"}
            {lastSynced ? ` · synced ${timeAgo(lastSynced / 1000)}` : ""}
          </p>
        </div>
        {meta && meta.teams.length > 0 && (
          <label className="team-switch">
            <span className="filter-label">Viewing</span>
            <select
              className="select team-select"
              value={meta.team?.id ?? ""}
              onChange={(e) => onSwitchTeam(Number(e.target.value))}
            >
              {meta.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="header-actions">
        {meta && meta.members.length > 0 && (
          <div className="avatars" aria-hidden="true">
            {meta.members
              .slice(0, 6)
              .map((m) =>
                m.avatarUrl ? <img key={m.accountId} src={m.avatarUrl} alt="" /> : <span key={m.accountId} />,
              )}
            {meta.members.length > 6 && <span className="more">+{meta.members.length - 6}</span>}
          </div>
        )}
        <button
          type="button"
          className="btn ghost icon-btn"
          onClick={() => onTheme(nextTheme)}
          title={`${THEME_LABEL[theme]} (switch to ${THEME_LABEL[nextTheme].toLowerCase()})`}
          aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme].toLowerCase()}`}
        >
          <ThemeIcon theme={theme} />
        </button>
        <button type="button" className="btn" onClick={onManageTeam}>
          Team
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={onSync}
          disabled={!meta || meta.members.length === 0 || sync?.running}
        >
          {sync?.running ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Syncing
            </>
          ) : (
            "Sync matches"
          )}
        </button>
      </div>
    </header>
  );
}
