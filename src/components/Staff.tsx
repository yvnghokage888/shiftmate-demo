// Staff management (/staff). Port of vanilla renderStaff + the staff modal
// (openAddStaff/editStaff/saveStaff), generatePin, resetStaffPassword,
// removeStaff, and the HR tab (notes + recurring-unavailable). Details tab is
// open to team read/write; the HR tab is gated by the hr grant.
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useMe, usePermissions, useStaff, useStaffTags, useRecurBlocks, useHrNote } from "@/lib/queries";
import {
  useSaveStaff,
  useRemoveStaff,
  useGeneratePin,
  useResetPassword,
  useAddRecurBlock,
  useDelRecurBlock,
  type StaffPayload,
} from "@/lib/mutations";
import { ini, formatNZPhone, sanitize, friendlyError, clientRateLimit } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/Modal";
import type { Staff as StaffT } from "@/lib/types";

const RECUR_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function Staff() {
  const { data: staff = [] } = useStaff();
  const { data: tags = [] } = useStaffTags();
  const { canWrite } = usePermissions();
  const generatePin = useGeneratePin();
  const [editing, setEditing] = useState<StaffT | "new" | null>(null);
  const [pinShow, setPinShow] = useState<{ name: string; code: string } | null>(null);

  const canWriteTeam = canWrite("team");

  function onGeneratePin(s: StaffT) {
    if (!clientRateLimit("gen_pin", 10)) {
      toast("Too many requests — wait a moment");
      return;
    }
    generatePin.mutate(s.id, {
      onSuccess: (pin) => setPinShow({ name: s.name, code: pin }),
      onError: (e) => toast(friendlyError(e)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Staff</h1>
        {canWriteTeam && <Button onClick={() => setEditing("new")}>+ Add staff</Button>}
      </div>

      {staff.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">
                    {ini(s.name)}
                  </div>
                  <div className="min-w-40 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant={s.is_manager ? "default" : "secondary"} className="text-[10px]">
                        {s.is_manager ? "Manager" : "Crew"}
                      </Badge>
                      <TagChips staff={s} tags={tags} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.email || "—"} · {s.phone ? formatNZPhone(s.phone) : "—"}
                    </div>
                  </div>
                  <Badge variant={s.has_pin ? "outline" : "secondary"} className="text-[10px]">
                    {s.has_pin ? "PIN set" : "No PIN"}
                  </Badge>
                  {canWriteTeam && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onGeneratePin(s)}>
                        {s.has_pin ? "Regen PIN" : "Gen PIN"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {editing && (
        <StaffModal
          key={editing === "new" ? "new" : editing.id}
          staff={editing === "new" ? null : editing}
          tags={tags}
          onClose={() => setEditing(null)}
        />
      )}

      {pinShow && (
        <Modal onClose={() => setPinShow(null)}>
          <h2 className="text-lg font-semibold">PIN for {pinShow.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Share this once — it won't be shown again.</p>
          <div className="my-4 text-center text-4xl font-bold tracking-widest tabular-nums">{pinShow.code}</div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setPinShow(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TagChips({ staff, tags }: { staff: StaffT; tags: { id: string; name: string; color: string | null }[] }) {
  const mine = (staff.tag_ids || []).map((id) => tags.find((t) => t.id === id)).filter(Boolean) as {
    id: string;
    name: string;
    color: string | null;
  }[];
  if (!mine.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {mine.map((t) => (
        <span
          key={t.id}
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: (t.color || "#888") + "22",
            color: t.color || "#888",
            border: `1px solid ${(t.color || "#888") + "66"}`,
          }}
        >
          {t.name}
        </span>
      ))}
    </span>
  );
}

function StaffModal({
  staff,
  tags,
  onClose,
}: {
  staff: StaffT | null;
  tags: { id: string; name: string; color: string | null }[];
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const { isManager, canRead, canWrite } = usePermissions();
  const save = useSaveStaff();
  const remove = useRemoveStaff();
  const resetPw = useResetPassword();

  const canHr = canRead("hr");
  const canHrWrite = canWrite("hr");
  const editingId = staff?.id ?? null;

  const [tab, setTab] = useState<"details" | "hr">("details");
  const [name, setName] = useState(staff?.name || "");
  const [phone, setPhone] = useState(staff?.phone || "");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState(staff?.email || "");
  const [minHours, setMinHours] = useState(staff?.min_hours != null ? String(staff.min_hours) : "");
  const [tagIds, setTagIds] = useState<Set<string>>(new Set(staff?.tag_ids || []));
  const [hrNote, setHrNote] = useState("");

  // HR note loads for existing staff with hr read.
  const hr = useHrNote(editingId, canHr && !!editingId);
  const hrOriginal = hr.data?.notes || "";
  const [hrTouched, setHrTouched] = useState(false);
  const hrValue = hrTouched ? hrNote : hrOriginal;

  function toggleTag(id: string) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSave() {
    const cleanName = sanitize(name);
    if (!cleanName) {
      toast("Please enter a name");
      return;
    }
    if (!clientRateLimit("save_staff", 20)) {
      toast("Too many requests — wait a moment");
      return;
    }
    const newPin = pin.replace(/\D/g, "").slice(0, 4) || null;
    const minH = parseInt(minHours, 10);
    const payload: StaffPayload = {
      name: cleanName,
      phone: sanitize(phone) || null,
      email: sanitize(email) || null,
      min_hours: isNaN(minH) || minH <= 0 ? null : minH,
      tag_ids: [...tagIds],
    };
    const hrChanged = canHrWrite && editingId != null && hrValue.trim() !== hrOriginal.trim();
    save.mutate(
      {
        editingId,
        before: staff,
        payload,
        newPin,
        hr: canHrWrite && editingId ? { changed: hrChanged, value: hrValue.trim() || null } : null,
      },
      {
        onSuccess: ({ warnings, loginMsg }) => {
          warnings.forEach((w) => toast(w));
          toast((editingId ? "Staff updated" : "Staff added") + loginMsg);
          onClose();
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onRemove() {
    if (!editingId) return;
    if (editingId === me?.id) {
      toast("You can't remove yourself");
      return;
    }
    if (!window.confirm(`Remove ${staff?.name} from the team?`)) return;
    remove.mutate(editingId, {
      onSuccess: () => {
        toast("Staff removed");
        onClose();
      },
      onError: (e) => toast(friendlyError(e)),
    });
  }

  function onReset() {
    if (!editingId) return;
    if (!window.confirm(`Reset ${staff?.name}'s password to the default password?`)) return;
    if (!clientRateLimit("reset_pw", 10)) {
      toast("Too many requests — wait a moment");
      return;
    }
    resetPw.mutate(editingId, {
      onSuccess: () => toast(`Password reset — they can sign in with the default password`),
      onError: (e) => toast(friendlyError(e)),
    });
  }

  const showReset = isManager && !!staff?.user_id;

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{editingId ? "Edit Staff Member" : "Add Staff Member"}</h2>
        {canHr && editingId && (
          <div className="flex gap-1 text-sm">
            <button
              className={`rounded px-2 py-1 ${tab === "details" ? "bg-muted font-medium" : "text-muted-foreground"}`}
              onClick={() => setTab("details")}
            >
              Details
            </button>
            <button
              className={`rounded px-2 py-1 ${tab === "hr" ? "bg-muted font-medium" : "text-muted-foreground"}`}
              onClick={() => setTab("hr")}
            >
              HR
            </button>
          </div>
        )}
      </div>

      {tab === "details" ? (
        <div className="mt-4 space-y-3">
          <Field label="Full name">
            <input className="ipt" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Smith" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input className="ipt" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+64 21 …" />
            </Field>
            <Field label="PIN (4 digits)">
              <input
                className="ipt"
                value={pin}
                maxLength={4}
                onChange={(e) => setPin(e.target.value)}
                placeholder={staff?.has_pin ? "•••• (blank = keep)" : "Set a 4-digit PIN"}
              />
            </Field>
          </div>
          <Field label="Email">
            <input className="ipt" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Teams / skills">
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && <span className="text-sm text-muted-foreground">No teams defined.</span>}
              {tags.map((t) => {
                const on = tagIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className="rounded-full border px-2.5 py-1 text-xs"
                    style={
                      on
                        ? { background: (t.color || "#888") + "22", color: t.color || "#888", borderColor: (t.color || "#888") + "66" }
                        : undefined
                    }
                  >
                    {on ? "✓ " : ""}
                    {t.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Min hours / week">
            <input
              className="ipt"
              type="number"
              min={0}
              max={80}
              value={minHours}
              onChange={(e) => setMinHours(e.target.value)}
              placeholder="e.g. 30 (optional)"
            />
          </Field>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Field label="HR notes">
            <textarea
              className="ipt"
              rows={6}
              disabled={!canHrWrite}
              value={hrValue}
              onChange={(e) => {
                setHrTouched(true);
                setHrNote(e.target.value);
              }}
              placeholder="Confidential HR notes — visible only to staff with HR access"
            />
          </Field>
          {hr.data?.updated_at && (
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(hr.data.updated_at).toLocaleString("en-NZ")}
            </p>
          )}
          {editingId && <RecurSection staffId={editingId} canWrite={canHrWrite} />}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        {editingId && (
          <Button variant="destructive" size="sm" onClick={onRemove} disabled={remove.isPending}>
            Remove
          </Button>
        )}
        {showReset && (
          <Button variant="outline" size="sm" onClick={onReset} disabled={resetPw.isPending}>
            Reset password
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={save.isPending}>
            {editingId ? "Save changes" : "Add staff"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RecurSection({ staffId, canWrite }: { staffId: string; canWrite: boolean }) {
  const { data: blocks = [] } = useRecurBlocks();
  const add = useAddRecurBlock();
  const del = useDelRecurBlock();
  const [weekday, setWeekday] = useState(1);
  const [reason, setReason] = useState("");

  const mine = blocks.filter((b) => b.staff_id === staffId).sort((a, b) => a.weekday - b.weekday);

  function onAdd() {
    if (!canWrite) return;
    if (!clientRateLimit("recur_block", 20)) {
      toast("Too many requests — wait a moment");
      return;
    }
    add.mutate(
      { staffId, weekday, reason: sanitize(reason) || null },
      {
        onSuccess: () => {
          toast(`${RECUR_DAYS[weekday]}s blocked`);
          setReason("");
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  return (
    <div>
      <div className="mb-1 text-sm font-medium">Recurring unavailable days</div>
      <p className="mb-2 text-xs text-muted-foreground">
        Blocks a weekday on every future occurrence.
      </p>
      {canWrite && (
        <div className="mb-2 flex gap-2">
          <select
            className="ipt w-32"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {RECUR_DAYS.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
          <input
            className="ipt flex-1"
            value={reason}
            maxLength={120}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (e.g. Church)"
          />
          <Button size="sm" variant="secondary" onClick={onAdd} disabled={add.isPending}>
            Add
          </Button>
        </div>
      )}
      {mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recurring days blocked.</p>
      ) : (
        <ul className="space-y-1">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{RECUR_DAYS[r.weekday]}s</span>
              <span className="flex-1 text-muted-foreground">{r.reason || "No reason"}</span>
              {canWrite && (
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    window.confirm(`Stop blocking ${RECUR_DAYS[r.weekday]}s?`) &&
                    del.mutate(r.id, { onError: (e) => toast(friendlyError(e)) })
                  }
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
