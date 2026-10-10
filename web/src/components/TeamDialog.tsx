import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Member, Team } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { playerStyle } from "./ui.tsx";

const STATUS_TEXT: Record<Member["historyStatus"], string> = {
  pending: "Not synced yet",
  ok: "Match data public",
  private: "Match data is private",
  error: "Couldn't read match history",
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function PlayerForm({
  label,
  placeholder,
  submit,
  onDone,
}: {
  label: string;
  placeholder: string;
  submit: (input: string) => Promise<unknown>;
  onDone: (result: unknown) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await submit(input);
      setInput("");
      onDone(result);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="add-row" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          disabled={busy}
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {label}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

export function TeamDialog({
  open,
  team,
  canDeleteTeam,
  members,
  onClose,
  onChanged,
  onTeamCreated,
  onTeamDeleted,
}: {
  open: boolean;
  team: Team | null;
  canDeleteTeam: boolean;
  members: Member[];
  onClose: () => void;
  onChanged: () => void;
  onTeamCreated: (teamId: number) => void;
  onTeamDeleted: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState<number | "team" | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setConfirming(null);
  }, [open]);

  async function remove(accountId: number) {
    if (!team) return;
    if (confirming !== accountId) return setConfirming(accountId);
    setConfirming(null);
    await api.removeMember(team.id, accountId);
    onChanged();
  }

  async function removeTeam() {
    if (!team) return;
    if (confirming !== "team") return setConfirming("team");
    await api.deleteTeam(team.id);
    onTeamDeleted();
  }

  const trackForm = (
    <PlayerForm
      label="Track"
      placeholder="Friend ID, SteamID or profile URL"
      submit={(input) => api.createTeam(input)}
      onDone={(created) => onTeamCreated((created as Team).id)}
    />
  );

  return (
    <dialog ref={ref} className="team-dialog" onClose={onClose}>
      <div className="dialog-body">
        {team ? (
          <>
            <h2>{team.name}'s team</h2>
            <p>
              Party mates with public match data are found on each sync and marked <span className="tag">auto</span>.
              Removed players aren't added back. Add someone by Dota friend ID, SteamID, Steam profile URL or Dotabuff
              link; they need <strong>Expose Public Match Data</strong> turned on in Dota 2.
            </p>
            <PlayerForm
              label="Add"
              placeholder="Friend ID, SteamID or profile URL"
              submit={(input) => api.addMember(team.id, input)}
              onDone={onChanged}
            />

            {members.length > 0 && (
              <ul className="member-list">
                {members.map((m) => (
                  <li key={m.accountId} style={playerStyle(m.colorSlot)}>
                    <span className="dot" aria-hidden="true" />
                    {m.avatarUrl && <img src={m.avatarUrl} alt="" />}
                    <div className="meta">
                      <strong>
                        {m.name}
                        {m.source === "auto" && <span className="tag">auto</span>}
                      </strong>
                      <span className={m.historyStatus === "private" ? "status-private" : undefined}>
                        {m.accountId} · {m.note ?? STATUS_TEXT[m.historyStatus]}
                      </span>
                    </div>
                    <button type="button" className="btn small ghost" onClick={() => remove(m.accountId)}>
                      {confirming === m.accountId ? "Confirm remove" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="dialog-section">Track another player</h3>
            <p className="dialog-hint">
              Gives them a view of their own with their own party mates. Switch views from the menu in the header.
            </p>
            {trackForm}
          </>
        ) : (
          <>
            <h2>Track a player</h2>
            <p>
              Add a player by Dota friend ID, SteamID, Steam profile URL or Dotabuff link. They need{" "}
              <strong>Expose Public Match Data</strong> turned on in Dota 2.
            </p>
            {trackForm}
          </>
        )}
      </div>
      <div className="dialog-foot">
        {team && canDeleteTeam && (
          <button type="button" className="btn ghost danger" onClick={removeTeam}>
            {confirming === "team" ? `Confirm: stop tracking ${team.name}` : "Stop tracking this player"}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
