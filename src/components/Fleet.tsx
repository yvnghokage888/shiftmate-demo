// Fleet management (/fleet). Port of vanilla renderTrucks + truck/truck-log
// CRUD. Per-truck weekly booking strip (a truck is "booked" on a day when a
// shift's job_name contains the truck name), expandable detail with the week's
// crew, WOF/REGO compliance, and maintenance logs. Read open to the fleet grant;
// writes are manager-gated (RLS enforces).
import { useState } from "react";
import { toast } from "sonner";
import { useStaff, useShifts, useTrucks, useTruckLogs } from "@/lib/queries";
import { useSaveTruck, useDeleteTruck, useSaveTruckLog, useDelTruckLog, type TruckPayload } from "@/lib/mutations";
import { usePermissions } from "@/lib/queries";
import { TZ, gwk, ds, nzToday, expiryInfo } from "@/lib/dates";
import { sanitize, friendlyError } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";
import type { Truck, Shift, Staff } from "@/lib/types";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STLABEL: Record<string, string> = { active: "Active", maintenance: "Maintenance", inactive: "Inactive" };
const TLOG_LABEL: Record<string, string> = { fuel: "Fuel", service: "Service", wof: "WOF", rego: "Rego", note: "Note" };

// Crew (name + start) booked on a truck for a given day: shift job_name contains the truck name.
function truckDayShifts(truck: Truck, dayShifts: Shift[], staffById: Map<string, Staff>) {
  const key = truck.name.toLowerCase();
  return dayShifts
    .filter((sh) => sh.job_name && sh.job_name.toLowerCase().includes(key))
    .map((sh) => ({
      name: staffById.get(sh.staff_id)?.name || "—",
      start: sh.start_time ? sh.start_time.slice(0, 5) : "",
    }));
}

export function Fleet() {
  const { data: trucks = [] } = useTrucks();
  const { data: truckLogs = [] } = useTruckLogs();
  const { data: shifts = [] } = useShifts();
  const { data: staff = [] } = useStaff();
  const { canWrite } = usePermissions();
  const canWriteFleet = canWrite("fleet");

  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [truckModal, setTruckModal] = useState<Truck | "new" | null>(null);
  const [logTruck, setLogTruck] = useState<Truck | null>(null);

  const dates = gwk(offset);
  const weekStrs = dates.map((d) => ds(d));
  const todayStr = nzToday();
  const mon = dates[0];
  const sun = dates[6];
  const rangeFmt =
    mon.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ }) +
    " – " +
    sun.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const shiftsByDate = new Map<string, Shift[]>();
  shifts.forEach((sh) => {
    if (sh.shift_type === "shift" && sh.job_name && weekStrs.includes(sh.date)) {
      const a = shiftsByDate.get(sh.date) || [];
      a.push(sh);
      shiftsByDate.set(sh.date, a);
    }
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Fleet</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
            ‹
          </Button>
          <button className="text-sm text-muted-foreground" onClick={() => setOffset(0)}>
            {offset === 0 ? "This week" : "Selected week"} · {rangeFmt}
          </button>
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + 1)}>
            ›
          </Button>
          {canWriteFleet && (
            <Button size="sm" onClick={() => setTruckModal("new")}>
              + Add truck
            </Button>
          )}
        </div>
      </div>

      {trucks.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No trucks yet — add your first asset.</p>
      ) : (
        <div className="space-y-3">
          {trucks.map((t) => {
            const color = t.color || "#6b7280";
            const isOpen = expanded.has(t.id);
            const wof = expiryInfo(t.wof_expiry);
            const rego = expiryInfo(t.rego_expiry);
            let bookedDays = 0;
            const squares = weekStrs.map((d, i) => {
              const booked = truckDayShifts(t, shiftsByDate.get(d) || [], staffById).length > 0;
              if (booked) bookedDays++;
              return (
                <span
                  key={i}
                  title={`${DOW[i]}${booked ? " · booked" : " · free"}`}
                  className="inline-block size-3 rounded-sm border"
                  style={booked ? { background: color, borderColor: color } : undefined}
                />
              );
            });
            const logs = truckLogs.filter((l) => l.truck_id === t.id);

            return (
              <div key={t.id} className="rounded-lg border" style={{ borderLeft: `3px solid ${color}` }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button className="text-muted-foreground" onClick={() => toggle(t.id)}>
                    {isOpen ? "▾" : "▸"}
                  </button>
                  <span
                    className="rounded px-2 py-0.5 text-xs font-bold text-white"
                    style={{ background: color }}
                  >
                    {(t.name || "").toUpperCase()}
                  </span>
                  <div className="min-w-32 flex-1">
                    <div className="text-sm font-medium">{t.type || "Vehicle"}</div>
                    <div className="text-xs text-muted-foreground">{t.registration || "—"}</div>
                  </div>
                  <span className="text-xs">{STLABEL[t.status || "active"] || "Active"}</span>
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-1">{squares}</div>
                    <span className="text-[10px] text-muted-foreground">{bookedDays}/7 booked</span>
                  </div>
                  {canWriteFleet && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setTruckModal(t)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogTruck(t)}>
                        + Log
                      </Button>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="grid gap-4 border-t px-4 py-3 md:grid-cols-2">
                    {/* Weekly schedule */}
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Weekly schedule</h4>
                      <div className="space-y-1">
                        {dates.map((d, i) => {
                          const d_ = ds(d);
                          const crew = truckDayShifts(t, shiftsByDate.get(d_) || [], staffById);
                          return (
                            <div key={i} className={`text-sm ${d_ === todayStr ? "font-medium" : ""}`}>
                              <span className="text-muted-foreground">
                                {DOW[i]} {d.toLocaleDateString("en-NZ", { day: "2-digit", timeZone: TZ })}:
                              </span>{" "}
                              {crew.length ? (
                                crew.map((c, j) => (
                                  <span key={j}>
                                    {c.name}
                                    {c.start ? ` (${c.start})` : ""}
                                    {j < crew.length - 1 ? ", " : ""}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted-foreground">Available</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Compliance + maintenance */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Compliance</h4>
                        <Compliance label="WOF" info={wof} />
                        <Compliance label="REGO" info={rego} />
                      </div>
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Maintenance</h4>
                        {logs.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No recent records.</p>
                        ) : (
                          <ul className="space-y-1">
                            {logs.map((l) => (
                              <li key={l.id} className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">
                                  {new Date(l.log_date + "T12:00").toLocaleDateString("en-NZ", {
                                    day: "numeric",
                                    month: "short",
                                    timeZone: TZ,
                                  })}
                                </span>
                                <span className="font-medium">{TLOG_LABEL[l.type || ""] || l.type}</span>
                                <span className="flex-1">
                                  {l.detail || ""}
                                  {l.cost != null ? ` · $${Number(l.cost).toFixed(2)}` : ""}
                                </span>
                                {canWriteFleet && (
                                  <DelLogBtn id={l.id} />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {truckModal && (
        <TruckModal
          key={truckModal === "new" ? "new" : truckModal.id}
          truck={truckModal === "new" ? null : truckModal}
          onClose={() => setTruckModal(null)}
        />
      )}
      {logTruck && (
        <TruckLogModal truck={logTruck} onClose={() => setLogTruck(null)} onSaved={() => setExpanded((p) => new Set(p).add(logTruck.id))} />
      )}
    </div>
  );
}

function Compliance({ label, info }: { label: string; info: ReturnType<typeof expiryInfo> }) {
  const color = !info ? "text-muted-foreground" : info.cls === "expired" ? "text-destructive" : info.cls === "soon" ? "text-amber-600" : "text-green-600";
  const sub = info ? (info.days < 0 ? `Expired ${-info.days}d ago` : `Due in ${info.days}d`) : "No date on record";
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={color}>
        {info ? info.fmt : "Not set"} <span className="text-xs">· {sub}</span>
      </span>
    </div>
  );
}

function DelLogBtn({ id }: { id: string }) {
  const del = useDelTruckLog();
  return (
    <button
      className="text-muted-foreground hover:text-destructive"
      title="Delete"
      onClick={() => window.confirm("Delete this log entry?") && del.mutate(id, { onSuccess: () => toast("Entry deleted"), onError: (e) => toast(friendlyError(e)) })}
    >
      ✕
    </button>
  );
}

function TruckModal({ truck, onClose }: { truck: Truck | null; onClose: () => void }) {
  const save = useSaveTruck();
  const del = useDeleteTruck();
  const editingId = truck?.id ?? null;
  const [name, setName] = useState(truck?.name || "");
  const [type, setType] = useState(truck?.type || "");
  const [rego, setRego] = useState(truck?.registration || "");
  const [status, setStatus] = useState(truck?.status || "active");
  const [notes, setNotes] = useState(truck?.notes || "");
  const [color, setColor] = useState(truck?.color || "#6b7280");
  const [wof, setWof] = useState(truck?.wof_expiry || "");
  const [regoExp, setRegoExp] = useState(truck?.rego_expiry || "");

  function onSave() {
    if (!name.trim()) {
      toast("Name is required");
      return;
    }
    const payload: TruckPayload = {
      name: name.trim(),
      type: type.trim() || null,
      registration: rego.trim() || null,
      status,
      notes: notes.trim() || null,
      color: color || "#6b7280",
      wof_expiry: wof || null,
      rego_expiry: regoExp || null,
    };
    save.mutate(
      { editingId, payload },
      {
        onSuccess: () => {
          toast(editingId ? "Truck updated" : "Truck added");
          onClose();
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onDelete() {
    if (!editingId) return;
    if (!window.confirm(`Delete ${truck?.name}? This permanently removes the truck.`)) return;
    del.mutate(editingId, {
      onSuccess: () => {
        toast("Truck deleted");
        onClose();
      },
      onError: (e) => toast(friendlyError(e)),
    });
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold">{editingId ? "Edit Truck" : "Add Truck"}</h2>
      <div className="space-y-3">
        <L label="Name">
          <input className="ipt" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gullwing" />
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label="Type">
            <input className="ipt" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Curtainsider" />
          </L>
          <L label="Registration">
            <input className="ipt" value={rego} onChange={(e) => setRego(e.target.value)} placeholder="ABC123" />
          </L>
        </div>
        <L label="Status">
          <select className="ipt" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active — in service</option>
            <option value="maintenance">Maintenance — in for repairs</option>
            <option value="inactive">Inactive — out of service</option>
          </select>
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label="WOF expiry">
            <input className="ipt" type="date" value={wof} onChange={(e) => setWof(e.target.value)} />
          </L>
          <L label="Rego expiry">
            <input className="ipt" type="date" value={regoExp} onChange={(e) => setRegoExp(e.target.value)} />
          </L>
        </div>
        <L label="Notes">
          <input className="ipt" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </L>
        <L label="Roster colour">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 rounded border" />
        </L>
      </div>
      <div className="mt-5 flex items-center gap-2">
        {editingId && (
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={del.isPending}>
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={save.isPending}>
            {editingId ? "Save changes" : "Add truck"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TruckLogModal({ truck, onClose, onSaved }: { truck: Truck; onClose: () => void; onSaved: () => void }) {
  const save = useSaveTruckLog();
  const [date, setDate] = useState(nzToday());
  const [type, setType] = useState("fuel");
  const [detail, setDetail] = useState("");
  const [cost, setCost] = useState("");

  function onSave() {
    save.mutate(
      {
        truckId: truck.id,
        logDate: date || nzToday(),
        type,
        detail: sanitize(detail) || null,
        cost: cost !== "" ? parseFloat(cost) : null,
      },
      {
        onSuccess: () => {
          toast("Log entry added");
          onSaved();
          onClose();
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold">Add Log Entry</h2>
      <p className="mb-4 text-sm text-muted-foreground">For {truck.name}</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <L label="Date">
            <input className="ipt" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </L>
          <L label="Type">
            <select className="ipt" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TLOG_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </L>
        </div>
        <L label="Detail">
          <input className="ipt" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. 65L diesel · BP Penrose" />
        </L>
        <L label="Cost (optional)">
          <input className="ipt" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
        </L>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={save.isPending}>
          Add entry
        </Button>
      </div>
    </Modal>
  );
}

function L({ label, children }: { label: string; children: import("react").ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
