// Anonymous PIN clock-in terminal (/kiosk). Port of the vanilla kiosk: a
// full-screen tablet terminal that runs WITHOUT a logged-in user — all auth is
// server-side via SECURITY DEFINER RPCs (kiosk_clock / kiosk_set_break /
// kiosk_open_clockins) that validate the PIN. Provisioning (kiosk_provision +
// the shiftmate_kiosk_device localStorage lock) is handled in App.tsx; this
// component is the terminal itself. Deliberately isolated from the authed app
// shell (no AppLayout, no router nav).
//
// Flow: staff tiles → PIN keypad → (on clock-out) break prompt → result screen
// (auto-returns to tiles after 4s). Tiles re-sync from the DB every ~30s so a
// clock-in on another device shows up here. After 20min idle on the tiles the
// page reloads to pick up new deploys.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { nzToday, ft, fmtTimeShort } from "@/lib/dates";
import { ini } from "@/lib/format";

interface KioskStaff {
  id: string;
  name: string;
  has_pin: boolean;
}
type Screen = "tiles" | "pin" | "break" | "result";
type ResultType = "in" | "out" | "blocked" | "early" | "error";
interface ResultState {
  type: ResultType;
  title: string;
  sub: string;
  chip: string;
  note?: string | null;
}

const IN_KEY = "shiftmate_kiosk_in";

const RESULT_CFG: Record<ResultType, { led: "green" | "amber" | "red"; chip: string; icon: string }> = {
  in: { led: "green", chip: "SESSION ACTIVE", icon: "✓" },
  out: { led: "amber", chip: "SESSION ENDED", icon: "⏏" },
  blocked: { led: "green", chip: "AWAITING ASSIGNMENT", icon: "⊘" },
  early: { led: "amber", chip: "CLOCK-IN NOT OPEN", icon: "⏱" },
  error: { led: "red", chip: "RETRY REQUIRED", icon: "!" },
};

export function Kiosk() {
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [screen, setScreen] = useState<Screen>("tiles");
  const [clockedIn, setClockedIn] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState(false);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState("");
  const [result, setResult] = useState<ResultState | null>(null);
  const [now, setNow] = useState(() => ft(new Date().toISOString()));
  const [busy, setBusy] = useState(false);

  const loadedAt = useRef(0);
  const tickC = useRef(0);
  const breakLogId = useRef<string | null>(null);
  const breakSub = useRef("");
  const resultTimer = useRef<number | null>(null);
  // Mirror live state for the interval callback (bound once).
  const screenRef = useRef<Screen>("tiles");
  screenRef.current = screen;

  function saveIn(ids: Set<string>) {
    try {
      localStorage.setItem(IN_KEY, JSON.stringify({ date: nzToday(), ids: [...ids] }));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }
  function loadIn(): Set<string> {
    try {
      const d = JSON.parse(localStorage.getItem(IN_KEY) || "{}");
      if (d.date === nzToday()) return new Set<string>(d.ids || []);
    } catch {
      /* ignore */
    }
    return new Set();
  }

  async function refreshIn(): Promise<Set<string> | null> {
    try {
      const { data, error } = await supabase.rpc("kiosk_open_clockins", { p_date: nzToday() });
      if (error || !data) return null;
      const ids = new Set<string>((data as { staff_id: string }[]).map((r) => r.staff_id));
      saveIn(ids);
      return ids;
    } catch {
      return null;
    }
  }

  function showTiles() {
    if (resultTimer.current) {
      clearTimeout(resultTimer.current);
      resultTimer.current = null;
    }
    setScreen("tiles");
    setStaffId(null);
    setPin("");
  }

  function showResult(r: ResultState) {
    setResult(r);
    setScreen("result");
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = window.setTimeout(showTiles, 4000);
  }

  // ── init: load staff + clocked-in state, then start the tick ──
  useEffect(() => {
    let alive = true;
    setClockedIn(loadIn()); // instant from cache
    (async () => {
      // has_pin may not be readable by the anon key; fall back to the basic query.
      let rows: KioskStaff[] = [];
      const first = await supabase
        .from("staff")
        .select("id,name,has_pin")
        .eq("active", true)
        .eq("is_manager", false)
        .order("name");
      if (first.error || !first.data?.length) {
        const second = await supabase
          .from("staff")
          .select("id,name")
          .eq("active", true)
          .eq("is_manager", false)
          .order("name");
        rows = (second.data || []).map((s) => ({ ...(s as { id: string; name: string }), has_pin: true }));
      } else {
        rows = first.data as KioskStaff[];
      }
      if (!alive) return;
      loadedAt.current = Date.now();
      setStaff(rows);
      const fresh = await refreshIn();
      if (alive && fresh) setClockedIn(fresh);
    })();

    const id = window.setInterval(async () => {
      // Idle deploy-refresh: only when sitting on the tiles, after 20min uptime.
      if (loadedAt.current && Date.now() - loadedAt.current > 20 * 60000 && screenRef.current === "tiles") {
        window.location.reload();
        return;
      }
      setNow(ft(new Date().toISOString()));
      // Every ~30s re-sync clocked-in from the DB (catches other devices).
      if (tickC.current++ % 3 === 0 && screenRef.current === "tiles") {
        const fresh = await refreshIn();
        if (fresh) setClockedIn(fresh);
      }
    }, 10000);

    return () => {
      alive = false;
      clearInterval(id);
      if (resultTimer.current) clearTimeout(resultTimer.current);
    };
  }, []);

  function tapStaff(s: KioskStaff) {
    if (!s.has_pin) return;
    setStaffId(s.id);
    setStaffName(s.name);
    setPin("");
    setPinErr(false);
    setScreen("pin");
  }

  function key(k: string) {
    setPinErr(false);
    setPin((prev) => {
      let next = prev;
      if (k === "back") next = prev.slice(0, -1);
      else if (k === "clear") next = "";
      else if (prev.length < 4) next = prev + k;
      if (next.length === 4) submitPin(next);
      return next;
    });
  }

  async function submitPin(enteredPin: string) {
    if (!staffId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("kiosk_clock", { p_staff_id: staffId, p_pin: enteredPin });
      if (error || !data) {
        showResult({ type: "error", title: "System error", sub: "Something went wrong — please try again", chip: RESULT_CFG.error.chip });
        return;
      }
      const d = data as { status: string; name?: string; log_id?: string; note?: string; start_time?: string };
      const nowStr = ft(new Date().toISOString());
      if (d.status === "bad_pin") {
        setPin("");
        setPinErr(true);
        return;
      }
      if (d.status === "out") {
        const next = new Set(clockedIn);
        next.delete(staffId);
        setClockedIn(next);
        saveIn(next);
        breakLogId.current = d.log_id || null;
        breakSub.current = `${d.name || ""} · ${nowStr}`;
        setScreen("break");
      } else if (d.status === "in") {
        const next = new Set(clockedIn);
        next.add(staffId);
        setClockedIn(next);
        saveIn(next);
        showResult({ type: "in", title: "Clocked in", sub: `${d.name || ""} · ${nowStr}`, chip: RESULT_CFG.in.chip, note: d.note || null });
      } else if (d.status === "no_shift") {
        showResult({ type: "blocked", title: "No shift rostered", sub: "Contact your supervisor for assignment updates.", chip: RESULT_CFG.blocked.chip });
      } else if (d.status === "early") {
        const stime = d.start_time ? fmtTimeShort(d.start_time) : "";
        showResult({ type: "early", title: "Too early to clock in", sub: `Rostered start is ${stime}. Clock-in opens 15 minutes before.`, chip: RESULT_CFG.early.chip });
      } else {
        showResult({ type: "error", title: "System error", sub: "Something went wrong — please try again", chip: RESULT_CFG.error.chip });
      }
    } catch {
      showResult({ type: "error", title: "System error", sub: "Something went wrong — please try again", chip: RESULT_CFG.error.chip });
    } finally {
      setBusy(false);
    }
  }

  async function submitBreak(took: boolean) {
    setScreen("result");
    if (breakLogId.current && staffId) {
      try {
        await supabase.rpc("kiosk_set_break", {
          p_staff_id: staffId,
          p_pin: pin,
          p_log_id: breakLogId.current,
          p_took: took,
        });
      } catch {
        /* break is best-effort; the clock-out already landed */
      }
    }
    breakLogId.current = null;
    showResult({ type: "out", title: "Clocked out", sub: breakSub.current, chip: RESULT_CFG.out.chip });
  }

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <div>
          <div className="text-lg font-bold tracking-tight">Demo Removals Co</div>
          <div className="text-xs uppercase tracking-widest text-neutral-500">Personnel Terminal / K01</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{now}</div>
          <div className="text-xs uppercase tracking-widest text-neutral-500">System Time</div>
        </div>
      </header>

      <main className="flex flex-1 flex-col p-6">
        {screen === "tiles" && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold">Tap your name to start</h1>
              <p className="text-sm text-neutral-400">Identify yourself to access the clock-in sequence.</p>
            </div>
            {staff.length === 0 ? (
              <div className="grid flex-1 place-items-center text-neutral-500">Loading crew…</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {staff.map((s) => {
                  const isIn = clockedIn.has(s.id);
                  const noPin = !s.has_pin;
                  return (
                    <button
                      key={s.id}
                      disabled={noPin}
                      onClick={() => tapStaff(s)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition ${
                        noPin
                          ? "cursor-not-allowed border-neutral-800 opacity-40"
                          : isIn
                            ? "border-green-600/60 bg-green-950/40 hover:bg-green-950/60"
                            : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                      }`}
                    >
                      <div className="grid size-14 place-items-center rounded-full bg-neutral-800 text-lg font-bold">
                        {ini(s.name)}
                      </div>
                      <div className="text-center text-sm font-semibold leading-tight">{s.name}</div>
                      <div className={`text-[11px] uppercase tracking-wide ${isIn ? "text-green-400" : "text-neutral-500"}`}>
                        {isIn ? "Clocked In" : noPin ? "PIN not set" : "Tap to clock"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {screen === "pin" && (
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
            <button onClick={showTiles} className="mb-4 self-start text-sm text-neutral-400 hover:text-neutral-200">
              ← Return to list
            </button>
            <h1 className="text-xl font-bold">Security Authentication</h1>
            <p className="mb-6 text-sm text-neutral-400">
              Identity: <strong className="text-neutral-100">{staffName}</strong>
            </p>

            {/* Dots */}
            <div className="mb-2 flex justify-center gap-4">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-4 rounded-full border ${i < pin.length ? "border-neutral-200 bg-neutral-200" : "border-neutral-600"}`}
                />
              ))}
            </div>
            <div className={`mb-4 h-5 text-center text-sm text-red-400 ${pinErr ? "" : "invisible"}`}>Wrong PIN — try again</div>

            {/* Numpad */}
            <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <KioskKey key={d} onClick={() => key(d)} disabled={busy}>
                  {d}
                </KioskKey>
              ))}
              <KioskKey onClick={() => key("clear")} disabled={busy} variant="muted">
                Clear
              </KioskKey>
              <KioskKey onClick={() => key("0")} disabled={busy}>
                0
              </KioskKey>
              <KioskKey onClick={() => key("back")} disabled={busy} variant="muted">
                ⌫
              </KioskKey>
            </div>
          </div>
        )}

        {screen === "break" && (
          <div className="grid flex-1 place-items-center">
            <div className="flex max-w-sm flex-col items-center text-center">
              <div className="mb-4 text-5xl">☕</div>
              <h1 className="text-2xl font-bold">Did you take a 30-min break?</h1>
              <p className="mb-6 mt-2 text-sm text-neutral-400">Tap to record your break for today's timesheet.</p>
              <div className="flex gap-4">
                <button
                  onClick={() => submitBreak(true)}
                  className="min-w-[130px] rounded-lg border border-neutral-600 bg-neutral-900 px-6 py-4 text-lg font-bold hover:bg-neutral-800"
                >
                  Yes
                </button>
                <button
                  onClick={() => submitBreak(false)}
                  className="min-w-[130px] rounded-lg border border-neutral-600 bg-neutral-900 px-6 py-4 text-lg font-bold hover:bg-neutral-800"
                >
                  No
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "result" && result && (
          <div className="grid flex-1 place-items-center">
            <div className="flex max-w-sm flex-col items-center text-center">
              <div
                className="mb-4 grid size-20 place-items-center rounded-2xl border border-neutral-700 text-4xl"
                style={{
                  color:
                    RESULT_CFG[result.type].led === "red"
                      ? "#ef4444"
                      : RESULT_CFG[result.type].led === "amber"
                        ? "#e9c400"
                        : "#95e400",
                }}
              >
                {RESULT_CFG[result.type].icon}
              </div>
              <h1 className="text-2xl font-bold">{result.title}</h1>
              <p className="mt-2 text-sm text-neutral-400">{result.sub}</p>
              {result.note && (
                <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300">
                  📝 {result.note}
                </div>
              )}
              <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-400">
                <span
                  className="size-2 rounded-full"
                  style={{
                    background:
                      RESULT_CFG[result.type].led === "red"
                        ? "#ef4444"
                        : RESULT_CFG[result.type].led === "amber"
                          ? "#e9c400"
                          : "#95e400",
                  }}
                />
                {result.chip}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-neutral-800 px-6 py-3 text-xs uppercase tracking-widest text-neutral-500">
        <span>● Kiosk Online · NODE_DEMO_CO</span>
        <span>Status: Ready</span>
      </footer>
    </div>
  );
}

function KioskKey({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "muted";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`grid h-16 place-items-center rounded-lg border text-xl font-semibold transition disabled:opacity-50 ${
        variant === "muted"
          ? "border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
          : "border-neutral-700 bg-neutral-800 hover:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}
