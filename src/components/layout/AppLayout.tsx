import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/store";
import { useMe, usePermissions } from "@/lib/queries";
import { useRealtime } from "@/hooks/useRealtime";
import { NAV } from "@/routes/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "@/components/layout/NotificationBell";

// Authed shell: permission-gated sidebar + header, with the active route in the
// <Outlet/>. Realtime subscriptions live here so they mount once for the session.
export function AppLayout() {
  const { signOut } = useAuth();
  const { data: me } = useMe();
  const { canRead, isManager } = usePermissions();
  useRealtime(true);

  const links = NAV.filter((n) => {
    if (n.always) return true;
    if (n.managerOnly) return isManager;
    if (n.resource) return canRead(n.resource);
    return true;
  });

  const toggleTheme = () => document.documentElement.classList.toggle("dark");

  return (
    <div className="grid min-h-svh grid-cols-[14rem_1fr] bg-background text-foreground">
      <aside className="flex flex-col border-r">
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <div className="grid size-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
            SM
          </div>
          <div>
            <div className="text-sm font-bold leading-none">ShiftMate</div>
            <div className="text-xs text-muted-foreground">React rebuild</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {links.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === "/"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          {me?.name}
          {isManager && (
            <Badge variant="secondary" className="ml-2">
              Manager
            </Badge>
          )}
        </div>
      </aside>

      <div className="flex flex-col">
        <header className="flex items-center justify-end gap-2 border-b px-6 py-3">
          <NotificationBell />
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            Theme
          </Button>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
