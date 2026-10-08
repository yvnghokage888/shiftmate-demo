// Manager Dashboard (/dashboard, manager-only). Read-only ops overview ported
// from vanilla renderDashboard: today's bento stats, the dispatch table, trucks
// rolling today, recent clock activity, and the week's notes/time-off. Derived
// entirely from loaded state; realtime invalidation keeps it live.
import { useMe, useStaff, useShifts, useClockLogs, useTrucks, useStaffTags } from "@/lib/queries";
import { TZ, gwk, ds, nzToday, ft, fmtTimeShort, addHoursToTime } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Shift, Staff, StaffTag } from "@/lib/types";

export function Dashboard() {
  const { data: staff = [] } = useStaff();
  const { data: shifts = [] } = useShifts();
  const { data: logs = [] } = useClockLogs();
  const { data: trucks = [] } = useTrucks();
  const { data: tags = [] } = useStaffTags();
  useMe();

  const today = nzToday();
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const todayShifts = shifts.filter((sh) => sh.date === today && sh.shift_type === "shift");
  const scheduledIds = new Set(todayShifts.map((sh) => sh.staff_id));
  const todayLogs = logs.filter((l) => l.date === today);
  const onDutyIds = new Set(todayLogs.filter((l) => l.clock_in && !l.clock_out).map((l) => l.staff_id));
  const clockedIds = new Set(todayLogs.filter((l) => l.clock_in).map((l) => l.staff_id));
  const offIds = new Set(
    shifts
      .filter((sh) => sh.date === today && (sh.shift_type === "time_off" || sh.shift_type === "break"))
      .map((sh) => sh.staff_id),
  );
  const trucksUsed = new Set(todayShifts.filter((sh) => sh.job_name).map((sh) => sh.job_name!.trim().toUpperCase())).size;
  const totalTrucks = trucks.length;
  const pending = [...scheduledIds].filter((id) => !clockedIds.has(id)).length;

  const dateStr = new Date().toLocaleDateString("en-NZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });

  // Dispatch rows
  const dispatch = todayShifts.slice().sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

  // Trucks rolling today
  const activeTrucks = trucks
    .map((t) => {
      const nm = (t.name || "").toLowerCase().trim();
      const sh = nm ? todayShifts.filter((s) => (s.job_name || "").toLowerCase().includes(nm)) : [];
      return { t, sh };
    })
    .filter((x) => x.sh.length)
    .sort((a, b) => firstStart(a.sh).localeCompare(firstStart(b.sh)));

  // Recent clock activity (last 6)
  const events: { t: string; txt: string; kind: "in" | "out" }[] = [];
  logs.forEach((l) => {
    const nm = staffById.get(l.staff_id)?.name || "Someone";
    if (l.clock_out) events.push({ t: l.clock_out, txt: `Clock out: ${nm}`, kind: "out" });
    if (l.clock_in) events.push({ t: l.clock_in, txt: `Clock in: ${nm}`, kind: "in" });
  });
  events.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  const feed = events.slice(0, 6);

  // Week notes & time off
  const weekNotes = buildWeekNotes(shifts, staff, tags, staffById);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{dateStr}</p>
      </div>

      {/* Bento stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Crew on duty" value={String(onDutyIds.size)} foot={`${clockedIds.size} clocked in today`} />
        <Stat
          label="Trucks rolling"
          value={totalTrucks ? `${trucksUsed} / ${totalTrucks}` : String(trucksUsed)}
          foot="matched to today's jobs"
        />
        <Stat label="Shifts booked" value={String(todayShifts.length)} foot={`${pending} pending check-in`} />
        <Stat label="Off / unavail." value={String(offIds.size)} foot={`of ${staff.length} crew`} />
      </div>

      {/* Dispatch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today's dispatch</CardTitle>
        </CardHeader>
        <CardContent>
          {dispatch.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts scheduled for today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-1">Staff</th>
                    <th className="py-1">Truck</th>
                    <th className="py-1">Window</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatch.map((sh) => {
                    const st = staffById.get(sh.staff_id);
                    const start = sh.start_time ? sh.start_time.slice(0, 5) : "";
                    const end = start && sh.duration_hours ? addHoursToTime(start, sh.duration_hours) : "";
                    const win = start ? `${start}${end ? ` – ${end}` : ""}` : "—";
                    const status = clockedIds.has(sh.staff_id)
                      ? { t: "Clocked in", c: "text-green-600" }
                      : offIds.has(sh.staff_id)
                        ? { t: "Off duty", c: "text-muted-foreground" }
                        : { t: "Pending", c: "text-amber-600" };
                    return (
                      <tr key={sh.id} className="border-t">
                        <td className="py-2">{st?.name || "—"}</td>
                        <td className="py-2">{sh.job_name ? sh.job_name.toUpperCase() : "N/A"}</td>
                        <td className="py-2">{win}</td>
                        <td className={`py-2 ${status.c}`}>{status.t}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Fleet today */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trucks rolling today</CardTitle>
          </CardHeader>
          <CardContent>
            {activeTrucks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trucks rostered today.</p>
            ) : (
              <ul className="space-y-2">
                {activeTrucks.map(({ t, sh }) => {
                  const names = [...new Set(sh.map((s) => s.staff_id))]
                    .map((id) => staffById.get(id)?.name)
                    .filter(Boolean) as string[];
                  const crewStr = names.length ? (names.length <= 2 ? names.join(", ") : `${names.length} crew`) : "";
                  const fs = firstStart(sh);
                  const sub = [t.registration, crewStr, fs ? `from ${fmtTimeShort(fs)}` : ""].filter(Boolean).join(" · ");
                  return (
                    <li key={t.id} className="flex items-center gap-2">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: t.color || "#888" }} />
                      <div>
                        <div className="text-sm font-medium">
                          {t.name}
                          {t.type ? ` (${t.type})` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">{sub}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent clock activity.</p>
            ) : (
              <ul className="space-y-2">
                {feed.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className={`inline-block size-2 rounded-full ${e.kind === "in" ? "bg-green-500" : "bg-muted-foreground"}`} />
                    <span className="flex-1">{e.txt}</span>
                    <span className="text-xs text-muted-foreground">{ft(e.t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Week notes & time off */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes &amp; time off — this week</CardTitle>
        </CardHeader>
        <CardContent>
          {weekNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes or time off this week.</p>
          ) : (
            <ul className="space-y-2">
              {weekNotes.map((it, i) => (
                <li key={i} className="flex items-start gap-2 border-l-2 pl-3" style={{ borderColor: it.color }}>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {it.day}
                      {it.who ? ` · ${it.who}` : ""}
                    </div>
                    <div className="text-sm">{it.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function firstStart(arr: Shift[]): string {
  return arr.map((s) => s.start_time || "").filter(Boolean).sort()[0] || "";
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{foot}</div>
    </div>
  );
}

type WeekNote = { day: string; who: string; text: string; color: string };

function buildWeekNotes(
  shifts: Shift[],
  staff: Staff[],
  tags: StaffTag[],
  staffById: Map<string, Staff>,
): WeekNote[] {
  const weekSet = new Set(gwk(0).map((d) => ds(d)));
  const hasNote = (sh: Shift) => sh.notes && sh.notes.trim() && sh.notes.trim() !== sh.job_name;
  const blocks = shifts.filter(
    (sh) =>
      weekSet.has(sh.date) &&
      (sh.shift_type === "time_off" ||
        sh.shift_type === "break" ||
        ((sh.shift_type === "comment" || sh.shift_type === "shift") && hasNote(sh))),
  );
  if (!blocks.length) return [];

  const describe = (sh: Shift) => {
    if (sh.shift_type === "comment" || sh.shift_type === "shift") return sh.notes!.trim();
    const win = sh.start_time
      ? ` ${fmtTimeShort(sh.start_time)}–${fmtTimeShort(addHoursToTime(sh.start_time, sh.duration_hours || 0))}`
      : "";
    const text = sh.shift_type === "time_off" ? (sh.start_time ? "Time off" + win : "Whole day off") : "Unavailable" + win;
    const note = sh.notes && sh.notes.trim() ? sh.notes.trim() : "";
    return note ? `${text} — ${note}` : text;
  };

  const allIds = new Set(staff.map((s) => s.id));
  const sameSet = (ids: Set<string>, arr: string[]) => arr.length === ids.size && arr.every((id) => ids.has(id));
  const audience = (ids: Set<string>) => {
    const n = ids.size;
    if (!n) return "";
    if (sameSet(ids, [...allIds])) return "Everyone";
    for (const t of tags) {
      const members = staff.filter((s) => (s.tag_ids || []).includes(t.id)).map((s) => s.id);
      if (members.length && sameSet(ids, members)) return t.name;
    }
    if (n > 4) return `${n} crew`;
    return [...ids].map((id) => staffById.get(id)?.name || "—").join(", ");
  };

  const byKey = new Map<string, { date: string; kind: string; text: string; ids: Set<string> }>();
  blocks.forEach((sh) => {
    const text = describe(sh);
    const key = sh.date + "|" + sh.shift_type + "|" + text;
    if (!byKey.has(key)) byKey.set(key, { date: sh.date, kind: sh.shift_type, text, ids: new Set() });
    byKey.get(key)!.ids.add(sh.staff_id);
  });

  const colFor = (k: string) =>
    k === "time_off" ? "#ef4444" : k === "break" ? "#94a3b8" : k === "shift" ? "#3b82f6" : "#f59e0b";

  return [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
    .map((it) => {
      const d = new Date(it.date + "T12:00");
      const day = d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
      return {
        day,
        who: audience(it.ids),
        text: it.kind === "shift" ? `${it.text} (on a shift)` : it.text,
        color: colFor(it.kind),
      };
    });
}
