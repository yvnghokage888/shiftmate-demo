// Notification bell + feed panel for the app header. Port of the vanilla
// renderNotifBell / renderNotifFeed / markNotifsRead / notifMarkAll behaviour:
// - unread badge (9+ cap)
// - opening the panel marks everything read
// - "Mark all read" clears the feed up to now (localStorage cut) so cleared
//   items don't reappear; only newer changes repopulate.
import { useState } from "react";
import { useNotifications, NOTIF_CLEARED_KEY } from "@/lib/queries";
import { useMarkNotifsRead } from "@/lib/mutations";
import { queryClient } from "@/lib/queryClient";
import { notifRelTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";

const TYPE_ICON: Record<string, string> = {
  shift_added: "➕",
  shift_changed: "✏️",
  shift_removed: "🗑️",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: notifs = [] } = useNotifications();
  const markRead = useMarkNotifsRead();

  const unread = notifs.filter((n) => !n.read_at).length;

  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening && unread > 0) markRead.mutate(undefined); // opening clears unread
  }

  function markAll() {
    localStorage.setItem(NOTIF_CLEARED_KEY, new Date().toISOString());
    markRead.mutate(undefined, {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    });
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={toggle} aria-label="Notifications">
        <span className="text-base leading-none">🔔</span>
        {unread > 0 && (
          <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={markAll}
                disabled={!notifs.length}
              >
                Mark all read
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No notifications yet.
                  <br />
                  You'll be told here when your shifts change.
                </div>
              ) : (
                <ul className="divide-y">
                  {notifs.map((n) => (
                    <li
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 ${n.read_at ? "" : "bg-muted/40"}`}
                    >
                      <span className="text-base leading-none">{TYPE_ICON[n.type] || "📅"}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-sm text-muted-foreground">{n.body}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {notifRelTime(n.created_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
