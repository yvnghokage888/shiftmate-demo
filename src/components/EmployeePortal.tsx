// Crew "My Shifts" portal (/me). Port of vanilla renderEmployee + the clock-note
// flow (toggleClock / submitClockAction). Logic is faithful; styling is plain
// shadcn for now (visual polish is a later pass).
import { useState } from "react";
import { toast } from "sonner";
import { useMe, usePermissions, useShifts, useClockLogs } from "@/lib/queries";
import { useClockMutation } from "@/lib/mutations";
import {
  TZ,
  ch,
  gwk,
  nzToday,
  nzNowHM,
  ft,
  fmtHrsNum,
  fmtTimeShort,
  addHoursToTime,
  payCycleRange,
} from "@/lib/dates";
import { sanitize, clientRateLimit, friendlyError } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Shift } from "@/lib/types";

function shiftStatus(s: Shift, nowHM: string): "Upcoming" | "In Progress" | "Completed" {
  const start = s.start_time ? s.start_time.slice(0, 5) : "";
  const end = start && s.duration_hours ? addHoursToTime(start, s.duration_hours) : "";
  if (start) {
    if (end && nowHM >= start && nowHM < end) return "In Progress";
    if (end && nowHM >= end) return "Completed";
    if (nowHM >= start) return "In Progress";
  }
  return "Upcoming";
}

export function EmployeePortal() {
  const { data: me } = useMe();
  const { isManager } = usePermissions();
  const { data: shifts = [] } = useShifts();
  const { data: logs = [] } = useClockLogs();
  const clock = useClockMutation();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  if (!me?.id) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>My Shifts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Account not linked to a staff record yet — contact your manager.
        </CardContent>
      </Card>
    );
  }

  const staffId = me.id;
  const todayStr = nzToday();
  const today = new Date();

  // Week stats (Mon–Sun) for this week.
  const my = shifts.filter((s) => s.staff_id === staffId);
  const wk = gwk(0);
  const wsh = my.filter((s) => {
    const d = new Date(s.date);
    return d >= wk[0] && d <= wk[6] && s.shift_type === "shift";
  });
  const daysRostered = new Set(wsh.map((s) => s.date)).size;

  // Pay-cycle (Thu→Wed) completed hours so far.
  const pc = payCycleRange(todayStr);
  const pcHrs = logs
    .filter((l) => l.staff_id === staffId && l.clock_out && l.date >= pc.startStr && l.date <= pc.endStr)
    .reduce((sum, l) => sum + (ch(l.clock_in, l.clock_out) || 0), 0);
  const pcRange =
    pc.start.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ }) +
    " – " +
    pc.end.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ });

  // Clock state for today.
  const openLog = logs.find((l) => l.staff_id === staffId && l.date === todayStr && !l.clock_out) || null;
  const todayLogs = logs.filter((l) => l.staff_id === staffId && l.date === todayStr && l.clock_out);
  const todayHrs = todayLogs.reduce((sum, l) => sum + (ch(l.clock_in, l.clock_out) || 0), 0);

  let clockDetail: string;
  if (openLog) {
    const mins = Math.round((Date.now() - new Date(openLog.clock_in!).getTime()) / 60000);
    clockDetail = `Clocked in at ${ft(openLog.clock_in)} · ${mins}m elapsed${
      todayHrs > 0 ? " · " + fmtHrsNum(todayHrs) + " logged today" : ""
    }`;
  } else {
    clockDetail =
      todayHrs > 0
        ? `${todayLogs.length} session${todayLogs.length > 1 ? "s" : ""} today · ${fmtHrsNum(todayHrs)} total`
        : "Not clocked in today";
  }

  // Today's shifts, ordered by start.
  const nowHM = nzNowHM();
  const todayShifts = my
    .filter((s) => s.date === todayStr && s.shift_type === "shift")
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));

  function onClockClick() {
    if (isManager) {
      toast("Managers don't clock in — crew clock in at the kiosk");
      return;
    }
    if (!clientRateLimit("clock_" + staffId, 20)) {
      toast("Slow down — too many requests");
      return;
    }
    setNoteText("");
    setNoteOpen(true);
  }

  function confirmClock() {
    const note = sanitize(noteText) || null;
    clock.mutate(
      { staffId, openLog, note },
      {
        onSuccess: (action) => {
          toast(action === "in" ? "Clocked in" : "Clocked out");
          setNoteOpen(false);
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{me.name}</h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString("en-NZ", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: TZ,
          })}
        </p>
      </div>

      {/* Clock card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2.5 rounded-full ${openLog ? "bg-green-500" : "bg-muted-foreground"}`}
            />
            <CardTitle className="text-base">{openLog ? "Clocked In" : "Clocked Out"}</CardTitle>
          </div>
          <Badge variant={openLog ? "default" : "secondary"}>{openLog ? "On Shift" : "Active"}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{clockDetail}</p>
          {noteOpen ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={
                  openLog
                    ? "Add an optional note (e.g. finishing early, lunch break)"
                    : "Add an optional note (e.g. started late, covering for someone)"
                }
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button onClick={confirmClock} disabled={clock.isPending}>
                  {clock.isPending ? "Saving…" : openLog ? "Clock Out" : "Clock In"}
                </Button>
                <Button variant="outline" onClick={() => setNoteOpen(false)} disabled={clock.isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={onClockClick} disabled={isManager}>
              {openLog ? "Clock Out" : "Clock In"}
            </Button>
          )}
          {isManager && (
            <p className="text-xs text-muted-foreground">
              Managers don't clock in — crew clock in at the kiosk.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Week stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Days rostered (this wk)" value={String(daysRostered)} />
        <Stat label="Shifts (this wk)" value={String(wsh.length)} />
        <Stat label={`Pay cycle · ${pcRange}`} value={`${Math.round(pcHrs * 10) / 10}h`} />
      </div>

      {/* Today's shifts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today's shifts</CardTitle>
        </CardHeader>
        <CardContent>
          {todayShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts today — check the Roster tab for your week.
            </p>
          ) : (
            <ul className="divide-y">
              {todayShifts.map((s) => {
                const start = s.start_time ? s.start_time.slice(0, 5) : "";
                const end = start && s.duration_hours ? addHoursToTime(start, s.duration_hours) : "";
                const win = start
                  ? `${fmtTimeShort(s.start_time)}${end ? " – " + fmtTimeShort(end + ":00") : ""}`
                  : "Time TBC";
                const status = shiftStatus(s, nowHM);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <div className="font-medium">{s.job_name || "Shift"}</div>
                      <div className="text-sm text-muted-foreground">{win}</div>
                      {s.notes && <div className="mt-1 text-xs text-muted-foreground">{s.notes}</div>}
                    </div>
                    <Badge
                      variant={
                        status === "In Progress" ? "default" : status === "Completed" ? "outline" : "secondary"
                      }
                    >
                      {status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <Separator className="mt-2 opacity-0" />
    </div>
  );
}
