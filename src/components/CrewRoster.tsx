// Crew "My Roster" (/my-roster). Read-only week view: per-day rostered shift vs
// actual clock record. Port of vanilla renderCrewRoster. Week navigation stays
// within the ±5wk shift window the data layer already fetches.
import { useState } from "react";
import { useMe, useShifts, useClockLogs, useTrucks } from "@/lib/queries";
import { TZ, gwk, ds, nzToday, ft, ch, fmtTimeShort, fmtHrsNum } from "@/lib/dates";
import { jobColour } from "@/lib/jobs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function CrewRoster() {
  const [offset, setOffset] = useState(0);
  const { data: me } = useMe();
  const { data: shifts = [] } = useShifts();
  const { data: logs = [] } = useClockLogs();
  const { data: trucks = [] } = useTrucks();

  const staffId = me?.id ?? null;
  const dates = gwk(offset);
  const todayStr = nzToday();
  const mon = dates[0];
  const sun = dates[6];
  const range =
    mon.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ }) +
    " – " +
    sun.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My Roster</h1>
          <p className="text-sm text-muted-foreground">{range}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
            ‹ Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>
            This week
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + 1)}>
            Next ›
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {dates.map((d, i) => {
          const dateStr = ds(d);
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;
          const dayDateFmt = d.toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "short",
            timeZone: TZ,
          });
          const shift = shifts.find(
            (s) => s.staff_id === staffId && s.date === dateStr && s.shift_type === "shift",
          );
          const dayOff = shifts.find(
            (s) => s.staff_id === staffId && s.date === dateStr && s.shift_type === "time_off",
          );
          const log = logs.find((l) => l.staff_id === staffId && l.date === dateStr);

          // Actual clock line.
          let clock: { text: string; missing: boolean } | null = null;
          if (log) {
            const inT = ft(log.clock_in);
            if (!log.clock_out) {
              clock = isPast
                ? { text: `In ${inT} · Forgot to clock out`, missing: true }
                : { text: `In ${inT} · Still clocked in`, missing: false };
            } else {
              const dur = ch(log.clock_in, log.clock_out);
              clock = {
                text: `${inT} – ${ft(log.clock_out)}${dur ? " · " + fmtHrsNum(dur) : ""}`,
                missing: false,
              };
            }
          } else if (isPast && shift) {
            clock = { text: "Not recorded", missing: true };
          }

          return (
            <Card key={i} className={isToday ? "border-primary" : isPast ? "opacity-70" : ""}>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                <div className="w-32 shrink-0">
                  <div className="font-semibold">{DAYS_LONG[i]}</div>
                  <div className="text-xs text-muted-foreground">{dayDateFmt}</div>
                  {isToday && <div className="text-xs font-medium text-primary">Today</div>}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {shift ? (
                      <>
                        {shift.start_time && (
                          <span className="text-sm">Starts {fmtTimeShort(shift.start_time)}</span>
                        )}
                        <span
                          className="rounded px-2 py-0.5 text-xs font-medium text-white"
                          style={{ background: jobColour(shift.job_name, trucks) }}
                        >
                          {shift.job_name || "Shift"}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {dayOff ? "Time off" : "No shift"}
                      </span>
                    )}
                  </div>
                  {shift?.notes && <div className="text-xs text-muted-foreground">{shift.notes}</div>}
                  {clock && (
                    <div className={`text-xs ${clock.missing ? "text-amber-600" : "text-muted-foreground"}`}>
                      <span className="font-medium">Clocked</span> {clock.text}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
