// Realtime → query invalidation. Subscribes to the same tables the vanilla app
// watched and invalidates the matching React Query keys (debounced) instead of
// hand-patching local state. Mount once, inside the authed shell.
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { queryClient, qk } from "../lib/queryClient";

type Table =
  | "shifts"
  | "clock_logs"
  | "trucks"
  | "truck_logs"
  | "staff"
  | "notifications"
  | "access_grants";

// Map a changed table to the query keys that should refetch.
function invalidateFor(table: Table) {
  switch (table) {
    case "shifts":
      return queryClient.invalidateQueries({ queryKey: ["shifts"] });
    case "clock_logs":
      return queryClient.invalidateQueries({ queryKey: qk.clockLogs() });
    case "trucks":
      return queryClient.invalidateQueries({ queryKey: qk.trucks() });
    case "truck_logs":
      return queryClient.invalidateQueries({ queryKey: qk.truckLogs() });
    case "staff":
      return queryClient.invalidateQueries({ queryKey: qk.staff() });
    case "notifications":
      // Key is ["notifications", staffId]; prefix match covers it. RLS scopes the
      // refetch to the current user's own rows.
      return queryClient.invalidateQueries({ queryKey: ["notifications"] });
    case "access_grants":
      return queryClient.invalidateQueries({ queryKey: qk.grants() });
  }
}

export function useRealtime(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    // Debounce bursts of changes into a single invalidation per table.
    const pending = new Set<Table>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const t of pending) invalidateFor(t);
      pending.clear();
    };
    const schedule = (t: Table) => {
      pending.add(t);
      if (!timer) timer = setTimeout(flush, 250);
    };

    const tables: Table[] = [
      "shifts",
      "clock_logs",
      "trucks",
      "truck_logs",
      "staff",
      "notifications",
      "access_grants",
    ];
    const channel = supabase.channel("app-rt");
    for (const t of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: t },
        () => schedule(t),
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
