import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/store";
import { useMe, usePermissions } from "@/lib/queries";
import { useRealtime } from "@/hooks/useRealtime";
import { NAV, SECTIONS } from "@/routes/config";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/NotificationBell";

// Authed shell: grouped, permission-gated sidebar rail + header, with the active
// route in the <Outlet/>. Realtime subscriptions live here so they mount once.
export function AppLayout() {
  const { signOut } = useAuth();
  const { data: me } = useMe();
  const { canRead, isManager } = usePermissions();
  const { pathname } = useLocation();
  useRealtime(true);

  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);

  const onToggle = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setNavOpen((o) => !o);
    else setCollapsed((c) => !c);
  };

  const links = NAV.filter((n) => {
    if (n.always) return true;
    if (n.managerOnly) return isManager;
    if (n.resource) return canRead(n.resource);
    return true;
  });

  const activeNav =
    NAV.find((n) => n.path !== "/" && pathname.startsWith(n.path)) ?? NAV.find((n) => n.path === "/");
  const wide = !!activeNav?.wide;

  const toggleTheme = () => document.documentElement.classList.toggle("dark");
  const initials = (me?.name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`grid min-h-svh grid-cols-1 bg-background text-foreground md:h-svh md:min-h-0 md:overflow-hidden ${
        collapsed ? "md:grid-cols-[1fr]" : "md:grid-cols-[12rem_1fr]"
      }`}
    >
      {/* Mobile drawer backdrop */}
      <div
        className={`fixed inset-0 z-[45] bg-black/50 transition-opacity duration-200 md:hidden ${
          navOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setNavOpen(false)}
        aria-hidden
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:sticky md:top-0 md:h-svh md:w-auto md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:hidden" : ""}`}
      >
        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-yellow text-sm font-extrabold text-[#2a0f33]">
            SM
          </div>
          <div>
            <div className="text-sm font-bold leading-none">ShiftMate</div>
            <div className="brand-wordmark mt-1 text-[10px] leading-none text-sidebar-label">Demo Removals Co</div>
          </div>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto p-2">
          {SECTIONS.map((section) => {
            const items = links.filter((n) => n.section === section.key);
            if (items.length === 0) return null;
            return (
              <div key={section.key} className="space-y-0.5">
                <div className="px-3 pb-0.5 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-label">
                  {section.label}
                </div>
                {items.map((n) => (
                  <NavLink
                    key={n.path}
                    to={n.path}
                    end={n.path === "/"}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                          : "font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${isActive ? "bg-yellow" : "bg-sidebar-muted/40"}`}
                        />
                        {n.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-sidebar-border p-3">
          <div
            className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
              isManager ? "bg-brand-2 text-brand-ink" : "bg-yellow text-[#5c4a04]"
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{me?.name}</div>
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-role">
              {isManager ? "Manager" : "Crew"}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-sidebar-border p-3 md:hidden">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-foreground"
            onClick={toggleTheme}
          >
            Theme
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-foreground"
            onClick={() => signOut()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col md:h-svh md:min-h-0">
        <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="outline" size="sm" onClick={onToggle} aria-label="Toggle menu" title="Toggle menu">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9.5 4v16" />
              </svg>
            </Button>
            <h1 className="truncate text-xl font-bold leading-none tracking-[-0.015em]">{activeNav?.label}</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Button variant="outline" size="sm" className="max-md:hidden" onClick={toggleTheme}>
              Theme
            </Button>
            <Button variant="outline" size="sm" className="max-md:hidden" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </header>
        <main
          className={`mx-auto w-full flex-1 px-4 pt-4 pb-6 md:min-h-0 md:overflow-y-auto md:px-6 md:pb-4 ${
            wide || collapsed ? "max-w-none" : "md:max-w-5xl"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
