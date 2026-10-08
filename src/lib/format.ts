// Pure string/format helpers + client rate limiter, ported from the vanilla app.
// escHtml is intentionally dropped — React escapes by default.

/** Initials from a name ("Jane Doe" → "JD"). */
export function ini(n?: string | null): string {
  if (!n) return "?";
  const p = n.trim().split(" ");
  return (p[0][0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

/** Display-only NZ phone formatter: +64 → 0, grouped digits. */
export function formatNZPhone(raw?: string | null): string {
  if (!raw) return "";
  let d = String(raw).replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("64")) d = "0" + d.slice(2); // +64 / 64 → 0
  else if (d && d[0] !== "0" && d.length >= 8) d = "0" + d; // bare 21xxxxxxx → 021…
  if (d.length < 8 || d[0] !== "0") return String(raw).trim(); // can't confidently format
  if (d[1] === "2") return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`.trim(); // mobile
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`.trim(); // landline
}

/** Strip HTML-injection chars and clamp length. Quotes/apostrophes kept (React escapes). */
export function sanitize(str?: string | null): string {
  if (!str) return "";
  return str.replace(/[<>]/g, "").trim().slice(0, 200);
}

/** Translate raw Supabase/network errors into plain English (vanilla friendlyError). */
export function friendlyError(err: unknown): string {
  if (!err) return "Something went wrong — please try again.";
  const e = err as { message?: string };
  const msg = (e.message || String(err)).toLowerCase();
  if (msg.includes("row-level security") || msg.includes("rls"))
    return "You don't have permission to do this. Try signing out and back in.";
  if (msg.includes("jwt expired") || msg.includes("session expired") || msg.includes("invalid jwt"))
    return "Your session has expired — please refresh the page and sign in again.";
  if (msg.includes("duplicate key") || msg.includes("unique constraint"))
    return "That entry already exists.";
  if (msg.includes("foreign key") || msg.includes("violates foreign key"))
    return "Can't do that — this record is linked to other data.";
  if (msg.includes("not null") || msg.includes("null value"))
    return "A required field is missing. Please fill in all fields.";
  if (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror")
  )
    return "Connection problem — check your internet and try again.";
  if (msg.includes("timeout")) return "The request timed out — check your connection and try again.";
  if (msg.includes("invalid input syntax") || msg.includes("invalid value"))
    return "One of the values entered is invalid — please check and try again.";
  if (msg.includes("permission denied")) return "You don't have permission to do this.";
  return e.message || "Something went wrong — please try again.";
}

/** Client-side rate limiter: false when `key` exceeds maxPerMin in the last minute. */
const _rl: Record<string, number[]> = {};
export function clientRateLimit(key: string, maxPerMin = 10): boolean {
  const now = Date.now();
  if (!_rl[key]) _rl[key] = [];
  _rl[key] = _rl[key].filter((t) => now - t < 60000);
  if (_rl[key].length >= maxPerMin) return false;
  _rl[key].push(now);
  return true;
}
