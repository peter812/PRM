import { Link, useLocation } from "wouter";
import type { ComponentProps } from "react";
import { Users, AtSign, CalendarDays, Menu, type LucideIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { UniversalAddButton } from "@/components/universal-add-button";

type AddHandlers = Omit<ComponentProps<typeof UniversalAddButton>, "className" | "iconClassName" | "side" | "align" | "testId">;

function NavTab({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
      data-testid={`nav-${href.slice(1)}`}
    >
      <Icon className="h-6 w-6" />
      {label}
    </Link>
  );
}

/** Mobile-only bottom bar: main sections, the universal add menu, and "More" to open the sidebar. */
export function MobileBottomNav(addHandlers: AddHandlers) {
  const [location] = useLocation();
  const { setOpenMobile } = useSidebar();

  const isActive = (path: string) =>
    (path === "/people" && location === "/") || location === path || location.startsWith(path + "/");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 md:hidden bg-background border-t z-50 pb-[env(safe-area-inset-bottom)]"
      data-testid="nav-mobile-bottom"
    >
      <div className="flex items-center justify-around px-1 h-14">
        <NavTab href="/people" label="People" icon={Users} active={isActive("/people")} />
        <NavTab href="/social-accounts" label="Accounts" icon={AtSign} active={isActive("/social-accounts")} />
        <div className="flex flex-1 justify-center">
          <UniversalAddButton
            {...addHandlers}
            className="h-11 w-11"
            iconClassName="h-6 w-6"
            side="top"
            align="center"
            testId="nav-add"
          />
        </div>
        <NavTab href="/daily-notes" label="Notes" icon={CalendarDays} active={isActive("/daily-notes")} />
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium text-muted-foreground"
          data-testid="nav-more"
        >
          <Menu className="h-6 w-6" />
          More
        </button>
      </div>
    </nav>
  );
}
