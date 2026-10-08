// Timesheets (/timesheets). Port of vanilla renderTimesheets + exportCSV /
// exportMonthCSV + openLogEdit/saveLog/deleteLog. Default single-week view
// (driven by an offset over the in-memory ±5wk window) with a custom From–To
// range that fetches fresh. Per-person collapsible sections, rostered-vs-actual
// day rows, and an add/edit clock-entry modal. Respects the timesheets grant:
// without read, everything is scoped to the current user's own rows.
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  useMe,
  usePermissions,
  useStaff,
  useShifts,
  useClockLogs,
  useTrucks,
  useTimesheetRange,
  fetchTimesheetMonth,
} from "@/lib/queries";
import { useSaveLog, useDeleteLog } from "@/lib/mutations";
import {
  TZ,
  gwk,
  ds,
  nzToday,
  ft,
  ch,
  hDec,
  fmtTimeShort,
  enumDates,
  monthBounds,
  nzDateTimeToISO,
  isoToNzTimeInput,
} from "@/lib/dates";
import { jobColour } from "@/lib/jobs";
import { downloadCsv } from "@/lib/csv";
import { sanitize, friendlyError } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Shift, ClockLog, Staff } from "@/lib/types";

const CSV_HEADER = [
  "Name",
  "Date",
  "Day",
  "Rostered",
  "Rostered Start",
  "Clock In",
  "Clock Out",
  "Actual Hours",
  "Note",
];

type EditCtx = { staffId: string; date: string; logId: string | null };

export function Timesheets() {
  const { data: me } = useMe();
  const { canRead, canWrite } = usePermissions();
  const { data: staff = [] } = useStaff();
  const { data: weekShifts = [] } = useShifts();
  const { data: weekLogs = [] } = useClockLogs();
  const { data: trucks = [] } = useTrucks();

  const [weekOffset, setWeekOffset] = useState(0);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState<string | null>(null);
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  const [openStaff, setOpenStaff] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<EditCtx | null>(null);

  const range = useTimesheetRange(appliedFrom, appliedTo);
  const rangeMode = !!(appliedFrom && appliedTo);

  const canT = canRead("timesheets");
  const canWriteT = canWrite("timesheets");
  const myId = me?.id ?? null;

  const dates = rangeMode ? enumDates(appliedFrom!, appliedTo!) : gwk(weekOffset);
  const dateSet = new Set(dates.map((d) => ds(d)));
  const mon = dates[0];
  const sun = dates[dates.length - 1];
  const todayStr = nzToday();

  const srcShifts: Shift[] = rangeMode ? range.data?.shifts ?? [] : weekShifts;
  const srcLogs: ClockLog[] = rangeMode ? range.data?.logs ?? [] : weekLogs;
  const allLogs = canT ? srcLogs : srcLogs.filter((l) => l.staff_id === myId);
  const staffToShow = canT ? staff : staff.filter((s) => s.id === myId);

  const rangeLabel =
    mon.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) +
    " – " +
    sun.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });

  function toggleStaff(id: string) {
    setOpenStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyRange() {
    if (!draftFrom || !draftTo) {
      toast("Pick both a start and an end date");
      return;
    }
    if (draftFrom > draftTo) {
      toast("Start date must be before end date");
      return;
    }
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
  }
  function clearRange() {
    setAppliedFrom(null);
    setAppliedTo(null);
  }

  // ── CSV builders (shared shape with vanilla exportCSV / exportMonthCSV) ──
  function pushRows(
    rows: (string | number)[][],
    s: Staff,
    dateStr: string,
    dayName: string,
    dayShift: Shift | undefined,
    dayLogs: ClockLog[],
  ) {
    const rJob = dayShift ? dayShift.job_name || "Shift" : "";
    const rStart = dayShift && dayShift.start_time ? fmtTimeShort(dayShift.start_time) : "";
    if (dayLogs.length) {
      dayLogs.forEach((l) =>
        rows.push([
          s.name || "",
          dateStr,
          dayName,
          rJob,
          rStart,
          ft(l.clock_in),
          l.clock_out ? ft(l.clock_out) : "",
          l.clock_out ? (ch(l.clock_in, l.clock_out) || 0).toFixed(2) : "",
          l.note || "",
        ]),
      );
    } else {
      rows.push([s.name || "", dateStr, dayName, rJob, rStart, "", "", "", ""]);
    }
  }

  function onExportCsv() {
    const rows: (string | number)[][] = [CSV_HEADER];
    staffToShow.forEach((s) => {
      dates.forEach((d) => {
        const dateStr = ds(d);
        const dayShift = srcShifts.find(
          (sh) => sh.staff_id === s.id && sh.date === dateStr && sh.shift_type === "shift",
        );
        const dayLogs = allLogs.filter((l) => l.staff_id === s.id && l.date === dateStr);
        if (!dayShift && !dayLogs.length) return;
        const dayName = d.toLocaleDateString("en-NZ", { weekday: "short", timeZone: TZ });
        pushRows(rows, s, dateStr, dayName, dayShift, dayLogs);
      });
    });
    if (rows.length === 1) {
      toast(rangeMode ? "Nothing to export for this range" : "Nothing to export for this week");
      return;
    }
    downloadCsv(`timesheets_${ds(mon)}_to_${ds(sun)}.csv`, rows);
  }

  async function onExportMonth() {
    const mb = monthBounds(ds(gwk(weekOffset)[0]));
    toast("Preparing month export…");
    try {
      const data = await fetchTimesheetMonth(mb.monthStart, mb.monthEnd, canT, myId);
      const rows: (string | number)[][] = [CSV_HEADER];
      staffToShow.forEach((s) => {
        for (let day = 1; day <= mb.lastDay; day++) {
          const dateStr = `${mb.yy}-${mb.pad(mb.mm)}-${mb.pad(day)}`;
          const dayShift = data.shifts.find((sh) => sh.staff_id === s.id && sh.date === dateStr);
          const dayLogs = data.logs.filter((l) => l.staff_id === s.id && l.date === dateStr);
          if (!dayShift && !dayLogs.length) continue;
          const dayName = new Date(dateStr + "T12:00").toLocaleDateString("en-NZ", {
            weekday: "short",
            timeZone: TZ,
          });
          pushRows(rows, s, dateStr, dayName, dayShift, dayLogs);
        }
      });
      if (rows.length === 1) {
        toast("Nothing to export for this month");
        return;
      }
      downloadCsv(`timesheets_${mb.yy}-${mb.pad(mb.mm)}.csv`, rows);
      toast(`Exported ${mb.monthStart} – ${mb.monthEnd}`);
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  // ── Per-person sections ──
  const sections = staffToShow
    .map((s) => {
      const personShifts = srcShifts.filter(
        (sh) => sh.staff_id === s.id && sh.shift_type === "shift" && dateSet.has(sh.date),
      );
      const personLogs = allLogs.filter((l) => l.staff_id === s.id && dateSet.has(l.date));
      if (!personShifts.length && !personLogs.length) return null;

      const rostCount = personShifts.length;
      const actHrs = personLogs.reduce((sum, l) => sum + (ch(l.clock_in, l.clock_out) || 0), 0);

      const dayRows = dates
        .map((d) => {
          const dateStr = ds(d);
          const dayShifts = personShifts.filter((sh) => sh.date === dateStr);
          const dayLogs = personLogs.filter((l) => l.date === dateStr);
          if (!dayShifts.length && !dayLogs.length) return null;
          const dayShift = dayShifts[0];
          const dayLog = dayLogs[0];
          const dayActHrs = dayLogs.reduce((sum, l) => sum + (ch(l.clock_in, l.clock_out) || 0), 0);
          const isToday = dateStr === todayStr;
          const dayName = d.toLocaleDateString("en-NZ", { weekday: "short", timeZone: TZ });
          const dayDateFmt = d
            .toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ })
            .toUpperCase();

          // Rostered line
          let rostered: ReactNode;
          if (dayShift && dayShift.start_time) {
            rostered = (
              <>
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: jobColour(dayShift.job_name, trucks) }}
                />
                <span className="text-muted-foreground">Rostered</span>
                <span>
                  {dayShift.job_name || "Shift"} · starts {fmtTimeShort(dayShift.start_time)}
                </span>
              </>
            );
          } else if (dayShift) {
            rostered = (
              <>
                <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground">Rostered</span>
                <span>{dayShift.job_name || "Shift"}</span>
              </>
            );
          } else {
            rostered = (
              <>
                <span className="inline-block size-2 rounded-full border" />
                <span className="text-muted-foreground">Rostered</span>
                <span className="text-muted-foreground">No shift</span>
              </>
            );
          }

          // Actual line
          let actual: ReactNode;
          if (!dayLog) {
            actual = (
              <div className="flex items-center gap-2 pl-4">
                <span className="w-14 text-muted-foreground">Actual</span>
                <span className="flex-1 text-muted-foreground">No clock-in recorded</span>
                {canWriteT && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setEdit({ staffId: s.id, date: dateStr, logId: null })}
                  >
                    + Add
                  </Button>
                )}
              </div>
            );
          } else {
            const inT = ft(dayLog.clock_in);
            const forgot = !dayLog.clock_out && !isToday;
            const outT = dayLog.clock_out ? ft(dayLog.clock_out) : forgot ? "Forgot to clock out" : "In progress";
            const actStr = forgot
              ? `In ${inT} · ${outT}`
              : `${inT} – ${outT}${dayActHrs ? " · " + hDec(dayActHrs) : ""}`;
            actual = (
              <div className="space-y-0.5 pl-4">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-muted-foreground">Actual</span>
                  <span className={`flex-1 ${forgot ? "font-semibold text-amber-600" : "text-green-600"}`}>
                    {actStr}
                  </span>
                  {canWriteT && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setEdit({ staffId: s.id, date: dateStr, logId: dayLog.id })}
                    >
                      {forgot ? "Fix" : "Edit"}
                    </Button>
                  )}
                </div>
                {dayLog.note && <div className="pl-16 text-xs text-muted-foreground">{dayLog.note}</div>}
                {dayLog.took_break != null && (
                  <div className="pl-16 text-xs text-muted-foreground">
                    Break: {dayLog.took_break ? "30 min taken" : "No break"}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={dateStr} className={`grid grid-cols-[5rem_1fr] gap-3 border-t py-2 ${isToday ? "bg-muted/30" : ""}`}>
              <div>
                <div className="text-sm font-medium">
                  {dayName}
                  {isToday && <span className="ml-1 text-[9px] font-bold text-primary">TODAY</span>}
                </div>
                <div className="text-xs text-muted-foreground">{dayDateFmt}</div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">{rostered}</div>
                {actual}
              </div>
            </div>
          );
        })
        .filter(Boolean);

      if (!dayRows.length) return null;
      const isOpen = openStaff.has(s.id);

      return (
        <Card key={s.id}>
          <button
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
            onClick={() => toggleStaff(s.id)}
          >
            <span className="text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
            <span className="flex-1 font-semibold">{s.name}</span>
            <span className="text-xs text-muted-foreground">
              {rostCount} shift{rostCount === 1 ? "" : "s"}
            </span>
            <span className="text-xs font-medium">{hDec(actHrs)}</span>
          </button>
          {isOpen && <CardContent className="pt-0">{dayRows}</CardContent>}
        </Card>
      );
    })
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Timesheets</h1>
          <p className="text-sm text-muted-foreground">
            Rostered vs actual · {rangeMode ? "custom range" : rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!rangeMode && (
            <>
              <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o - 1)}>
                ‹ Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
                This week
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
                Next ›
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={onExportCsv}>
            Export CSV
          </Button>
          {!rangeMode && (
            <Button variant="outline" size="sm" onClick={onExportMonth}>
              Export Month
            </Button>
          )}
        </div>
      </div>

      {/* Custom range picker */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Custom range:</span>
        <input
          type="date"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          className="rounded-md border bg-background px-2 py-1"
        />
        <span className="text-muted-foreground">to</span>
        <input
          type="date"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          className="rounded-md border bg-background px-2 py-1"
        />
        <Button variant="secondary" size="sm" onClick={applyRange}>
          Apply
        </Button>
        {rangeMode && (
          <Button variant="ghost" size="sm" onClick={clearRange}>
            Clear range
          </Button>
        )}
        {rangeMode && <span className="text-muted-foreground">{rangeLabel}</span>}
      </div>

      {rangeMode && range.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading range…</p>
      ) : sections.length ? (
        <div className="space-y-3">{sections}</div>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No activity {rangeMode ? "for this range" : "this week"}.
        </p>
      )}

      {edit && (
        <LogEditModal
          ctx={edit}
          staff={staff}
          shifts={srcShifts}
          logs={srcLogs}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function LogEditModal({
  ctx,
  staff,
  shifts,
  logs,
  onClose,
}: {
  ctx: EditCtx;
  staff: Staff[];
  shifts: Shift[];
  logs: ClockLog[];
  onClose: () => void;
}) {
  const { staffId, date, logId } = ctx;
  const log = logId ? logs.find((l) => l.id === logId) : null;
  const rostShift = !logId
    ? shifts.find((s) => s.staff_id === staffId && s.date === date && s.shift_type === "shift")
    : null;
  const defIn = rostShift?.start_time ? rostShift.start_time.slice(0, 5) : "";

  const [inT, setInT] = useState(isoToNzTimeInput(log?.clock_in) || defIn);
  const [outT, setOutT] = useState(isoToNzTimeInput(log?.clock_out));
  const [note, setNote] = useState(log?.note || "");
  const save = useSaveLog();
  const del = useDeleteLog();

  const staffName = staff.find((s) => s.id === staffId)?.name || "—";
  const dateFmt = new Date(date + "T12:00").toLocaleDateString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });

  function onSave() {
    if (!inT) {
      toast("Clock-in time is required");
      return;
    }
    const clockIn = nzDateTimeToISO(date, inT);
    const clockOut = outT ? nzDateTimeToISO(date, outT) : null;
    if (clockOut && new Date(clockOut) <= new Date(clockIn)) {
      toast("Clock-out must be after clock-in");
      return;
    }
    save.mutate(
      { logId: logId || null, staffId, date, clockIn, clockOut, note: sanitize(note) || null },
      {
        onSuccess: () => {
          toast(logId ? "Clock times updated" : "Entry added");
          onClose();
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onDelete() {
    if (!logId) return;
    if (!window.confirm("Delete this clock entry?")) return;
    del.mutate(logId, {
      onSuccess: () => {
        toast("Entry deleted");
        onClose();
      },
      onError: (e) => toast(friendlyError(e)),
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{logId ? "Edit Clock Times" : "Add Clock Entry"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {staffName} · {dateFmt}
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Clock in</span>
            <input
              type="time"
              value={inT}
              onChange={(e) => setInT(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Clock out</span>
            <input
              type="time"
              value={outT}
              onChange={(e) => setOutT(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          {logId ? (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={del.isPending}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={save.isPending}>
              {logId ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
