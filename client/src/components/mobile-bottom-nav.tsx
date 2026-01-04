import { Link, useLocation } from "wouter";
import { Users, UsersRound, Plus, Box, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileBottomNavProps {
  onAddPersonClick: () => void;
}

export function MobileBottomNav({ onAddPersonClick }: MobileBottomNavProps) {
  const [location] = useLocation();

  const isActive = (path: string) => {
    if (path === "/people" && (location === "/" || location === "/people")) {
      return true;
    }
    return location === path || location.startsWith(path + "/");
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-background border-t z-50" data-testid="nav-mobile-bottom">
      <div className="flex items-center justify-around py-1 px-1">
        <Link href="/groups">
          <Button
            variant="ghost"
            size="icon"
            className={`h-11 w-11 ${isActive("/groups") ? "text-primary" : "text-muted-foreground"}`}
            data-testid="nav-groups"
          >
            <UsersRound className="h-7 w-7" />
          </Button>
        </Link>

        <Link href="/people">
          <Button
            variant="ghost"
            size="icon"
            className={`h-11 w-11 ${isActive("/people") ? "text-primary" : "text-muted-foreground"}`}
            data-testid="nav-people"
          >
            <Users className="h-7 w-7" />
          </Button>
        </Link>

        <Button
          variant="default"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={onAddPersonClick}
          data-testid="nav-add-person"
        >
          <Plus className="h-7 w-7" />
        </Button>

        <Link href="/graph-3d">
          <Button
            variant="ghost"
            size="icon"
            className={`h-11 w-11 ${isActive("/graph-3d") ? "text-primary" : "text-muted-foreground"}`}
            data-testid="nav-graph-3d"
          >
            <Box className="h-7 w-7" />
          </Button>
        </Link>

        <Link href="/social-accounts">
          <Button
            variant="ghost"
            size="icon"
            className={`h-11 w-11 ${isActive("/social-accounts") ? "text-primary" : "text-muted-foreground"}`}
            data-testid="nav-social-accounts"
          >
            <AtSign className="h-7 w-7" />
          </Button>
        </Link>
      </div>
    </nav>
  );
}
