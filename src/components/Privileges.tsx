// Privileges (/privileges, manager-only). Port of vanilla renderPrivList/
// renderPrivMain + privSave. Left pane: Teams / Individuals selector. Right
// pane: per-resource read/write matrix with "write implies read", team
// inheritance shown as locked toggles + chips, and an Admin toggle (is_manager)
// for individuals. Edits are staged in a draft and committed on Save.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMe, useStaff, useStaffTags, useGrants } from "@/lib/queries";
import { usePrivSave } from "@/lib/mutations";
import { ini, friendlyError } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Grant, Staff } from "@/lib/types";

const PRIV_RES: [string, string, string][] = [
  ["roster", "Roster", "View and manage scheduling calendars"],
  ["timesheets", "Timesheets", "Entry and approval of hours worked"],
  ["team", "Team", "Staff profiles and contact details"],
  ["fleet", "Fleet", "Vehicle allocation and maintenance logs"],
  ["hr", "HR", "Compliance documents and performance"],
  ["dispatch", "Dispatch", "Scheduled jobs: assign trucks and crew"],
  ["cleaning", "Cleaning", "Cleaning bookings and cleaner assignment"],
  ["invoicing", "Invoices", "Invoices, GST and payment status"],
];
const RES_KEYS = PRIV_RES.map(([k]) => k);

type Subject = { type: "staff" | "team"; id: string; name: string };
type Draft = { perms: Record<string, { read: boolean; write: boolean }>; admin: boolean };
type LogEntry = { text: string; by: string; at: number };

function draftFromGrants(subject: Subject, grants: Grant[], staffRow: Staff | null): Draft {
  const perms: Record<string, { read: boolean; write: boolean }> = {};
  for (const [res] of PRIV_RES) {
    const g = grants.find(
      (x) => x.subject_type === subject.type && x.subject_id === subject.id && x.resource === res,
    );
    perms[res] = { read: !!(g && g.can_read), write: !!(g && g.can_write) };
  }
  return { perms, admin: subject.type === "staff" ? !!staffRow?.is_manager : false };
}

export function Privileges() {
  const { data: me } = useMe();
  const { data: staff = [] } = useStaff();
  const { data: tags = [] } = useStaffTags();
  const { data: grants = [] } = useGrants();
  const save = usePrivSave();

  const [tab, setTab] = useState<"teams" | "individuals">("teams");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const staffRow = subject?.type === "staff" ? staff.find((s) => s.id === subject.id) ?? null : null;

  function select(type: "staff" | "team", id: string) {
    const name =
      type === "team" ? tags.find((t) => t.id === id)?.name : staff.find((s) => s.id === id)?.name;
    const subj: Subject = { type, id, name: name || "" };
    const sRow = type === "staff" ? staff.find((s) => s.id === id) ?? null : null;
    setSubject(subj);
    setDraft(draftFromGrants(subj, grants, sRow));
  }

  function subjectGrantCount(type: "staff" | "team", id: string) {
    return grants.filter(
      (g) => g.subject_type === type && g.subject_id === id && (g.can_read || g.can_write),
    ).length;
  }

  // What an individual inherits from their team grants (additive base).
  const inherited = useMemo(() => {
    const inh: Record<string, { read: boolean; write: boolean }> = {};
    const teamsBy: Record<string, string[]> = {};
    RES_KEYS.forEach((res) => {
      inh[res] = { read: false, write: false };
      teamsBy[res] = [];
    });
    if (subject?.type !== "staff" || !staffRow) return { inh, teamsBy };
    const tagIds = staffRow.tag_ids || [];
    grants.forEach((g) => {
      if (g.subject_type !== "team" || !tagIds.includes(g.subject_id) || !inh[g.resource]) return;
      if (g.can_write) {
        inh[g.resource].write = true;
        inh[g.resource].read = true;
      }
      if (g.can_read) inh[g.resource].read = true;
      if (g.can_read || g.can_write) {
        const t = tags.find((x) => x.id === g.subject_id);
        if (t && !teamsBy[g.resource].includes(t.name)) teamsBy[g.resource].push(t.name);
      }
    });
    return { inh, teamsBy };
  }, [subject, staffRow, grants, tags]);

  const dirty = useMemo(() => {
    if (!subject || !draft) return false;
    if (subject.type === "staff" && !!draft.admin !== !!staffRow?.is_manager) return true;
    return PRIV_RES.some(([res]) => {
      const g = grants.find(
        (x) => x.subject_type === subject.type && x.subject_id === subject.id && x.resource === res,
      );
      return draft.perms[res].read !== !!(g && g.can_read) || draft.perms[res].write !== !!(g && g.can_write);
    });
  }, [subject, draft, grants, staffRow]);

  function setPriv(res: string, kind: "read" | "write", on: boolean) {
    setDraft((prev) => {
      if (!prev) return prev;
      const cell = { ...prev.perms[res] };
      if (kind === "read") {
        cell.read = on;
        if (!on) cell.write = false; // no read → no write
      } else {
        cell.write = on;
        if (on) cell.read = true; // write implies read
      }
      return { ...prev, perms: { ...prev.perms, [res]: cell } };
    });
  }

  function setAdmin(on: boolean) {
    if (!subject || subject.type !== "staff" || subject.id === me?.id) return;
    setDraft((prev) => (prev ? { ...prev, admin: on } : prev));
  }

  function onSave() {
    if (!subject || !draft || !dirty) return;
    save.mutate(
      { subject, draft, grants, staffRow, resources: RES_KEYS },
      {
        onSuccess: (changed) => {
          if (changed.length) {
            const labels = changed.map((c) => PRIV_RES.find(([k]) => k === c)?.[1] || c);
            setLog((prev) =>
              [{ text: `Updated ${labels.join(", ")} for ${subject.name}`, by: me?.name || "You", at: Date.now() }, ...prev].slice(0, 6),
            );
          }
          // Re-sync the draft from the (about to refetch) grants; keep current as-is.
          toast("Privileges saved");
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onCancel() {
    if (subject) setDraft(draftFromGrants(subject, grants, staffRow));
  }

  const adminOn = subject?.type === "staff" && !!draft?.admin;
  const isSelf = subject?.type === "staff" && subject.id === me?.id;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Privileges</h1>
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        {/* Left: selector */}
        <div className="space-y-2">
          <div className="flex gap-1 rounded-md border p-1 text-sm">
            <button
              className={`flex-1 rounded px-2 py-1 ${tab === "teams" ? "bg-muted font-medium" : "text-muted-foreground"}`}
              onClick={() => setTab("teams")}
            >
              Teams
            </button>
            <button
              className={`flex-1 rounded px-2 py-1 ${tab === "individuals" ? "bg-muted font-medium" : "text-muted-foreground"}`}
              onClick={() => setTab("individuals")}
            >
              Individuals
            </button>
          </div>
          <div className="space-y-1">
            {tab === "teams"
              ? tags.length
                ? tags.map((t) => (
                    <SelButton
                      key={t.id}
                      active={subject?.type === "team" && subject.id === t.id}
                      onClick={() => select("team", t.id)}
                      dot={t.color || "#888"}
                      name={t.name}
                      count={subjectGrantCount("team", t.id)}
                    />
                  ))
                : <Empty>No teams yet</Empty>
              : staff.length
                ? staff.map((s) => (
                    <SelButton
                      key={s.id}
                      active={subject?.type === "staff" && subject.id === s.id}
                      onClick={() => select("staff", s.id)}
                      avatar={ini(s.name)}
                      name={s.name}
                      admin={s.is_manager}
                      count={subjectGrantCount("staff", s.id)}
                    />
                  ))
                : <Empty>No crew</Empty>}
          </div>
        </div>

        {/* Right: matrix */}
        <div>
          {!subject || !draft ? (
            <div className="grid min-h-64 place-items-center rounded-lg border text-center text-sm text-muted-foreground">
              <div>
                <div className="font-medium text-foreground">Select a team or individual</div>
                <div>Choose someone on the left to view and edit their access.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{subject.name}</h2>
                  <Badge variant="secondary">{subject.type === "team" ? "TEAM" : "INDIVIDUAL"}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={onCancel} disabled={!dirty}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending}>
                    Save changes
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  <span>Module</span>
                  <span className="text-center">Read</span>
                  <span className="text-center">Write</span>
                </div>

                {subject.type === "staff" && (
                  <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b px-4 py-3">
                    <div>
                      <div className="font-medium text-amber-600">Admin Access</div>
                      <div className="text-xs text-muted-foreground">
                        Full access to all modules; can edit others' privileges.
                      </div>
                      {isSelf && <div className="text-xs text-amber-600">Cannot remove your own admin status</div>}
                    </div>
                    <span />
                    <div className="text-center">
                      <input
                        type="checkbox"
                        checked={!!adminOn}
                        disabled={!!isSelf}
                        onChange={(e) => setAdmin(e.target.checked)}
                      />
                    </div>
                  </div>
                )}

                {PRIV_RES.map(([res, label, desc]) => {
                  const d = draft.perms[res];
                  const ir = (inherited.inh[res]?.read || false) || !!adminOn;
                  const iw = (inherited.inh[res]?.write || false) || !!adminOn;
                  const teams = inherited.teamsBy[res] || [];
                  return (
                    <div key={res} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b px-4 py-3 last:border-0">
                      <div>
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{desc}</div>
                        {adminOn ? (
                          <div className="text-xs text-amber-600">Granted via Admin Access</div>
                        ) : (ir || iw) ? (
                          <div className="text-xs text-muted-foreground" title={teams.join(", ")}>
                            Inherited{teams.length ? ` · ${teams.join(", ")}` : ""}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-center">
                        <input
                          type="checkbox"
                          checked={ir || d.read}
                          disabled={ir}
                          onChange={(e) => setPriv(res, "read", e.target.checked)}
                        />
                      </div>
                      <div className="text-center">
                        <input
                          type="checkbox"
                          checked={iw || d.write}
                          disabled={iw}
                          onChange={(e) => setPriv(res, "write", e.target.checked)}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
                  Write implies Read. Removing Read removes Write. Admins always have full access.
                </div>
              </div>

              {/* Activity log (session-only) */}
              <div className="rounded-lg border p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Activity log</div>
                {log.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No changes yet this session.</div>
                ) : (
                  <ul className="space-y-2">
                    {log.map((e, i) => (
                      <li key={i} className="text-sm">
                        <div>{e.text}</div>
                        <div className="text-xs text-muted-foreground">by {e.by}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SelButton({
  active,
  onClick,
  name,
  count,
  dot,
  avatar,
  admin,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  count: number;
  dot?: string;
  avatar?: string;
  admin?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${active ? "border-primary bg-muted" : ""}`}
    >
      {dot && <span className="inline-block size-2.5 rounded-full" style={{ background: dot }} />}
      {avatar && <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-bold">{avatar}</span>}
      <span className="flex-1 truncate">{name}</span>
      {admin && <Badge className="text-[9px]">ADMIN</Badge>}
      {count > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px]">{count}</span>}
    </button>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="px-3 py-2 text-sm text-muted-foreground">{children}</div>;
}
