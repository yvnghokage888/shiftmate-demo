import { QueryClient } from "@tanstack/react-query";

// Single shared client. Realtime (src/hooks/useRealtime.ts) invalidates keys on
// DB changes, so we don't need aggressive polling; keep data fresh-ish but lean
// on invalidation for the live updates the vanilla app did with manual patches.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Centralised query keys so hooks and realtime invalidation agree on names.
export const qk = {
  me: (uid: string | null) => ["me", uid] as const,
  permissions: (uid: string | null) => ["permissions", uid] as const,
  staff: () => ["staff"] as const,
  shifts: (start: string, end: string) => ["shifts", start, end] as const,
  clockLogs: () => ["clock_logs"] as const,
  trucks: () => ["trucks"] as const,
  truckLogs: () => ["truck_logs"] as const,
  staffTags: () => ["staff_tags"] as const,
  recurBlocks: () => ["recur_blocks"] as const,
  notifications: (staffId: string | null) => ["notifications", staffId] as const,
  grants: () => ["access_grants"] as const,
  jobs: () => ["jobs"] as const,
  invoices: () => ["invoices"] as const,
  hrNote: (staffId: string | null) => ["hr_note", staffId] as const,
};
