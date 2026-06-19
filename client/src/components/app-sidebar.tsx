import {
  Users,
  Users2,
  User,
  AtSign,
  Trophy,
  Share2,
  GitBranch,
  Link2,
  Settings,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Scan,
  Sparkles,
  MessagesSquare,
  BookOpen,
  Home,
  Image,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

const menuItems = [
  {
    title: "Home",
    url: "/home",
    icon: Home,
  },
  {
    title: "Me",
    url: "/me",
    icon: User,
  },
  {
    title: "People",
    url: "/",
    icon: Users,
  },
  {
    title: "Family Tree",
    url: "/family-tree",
    icon: GitBranch,
  },
  {
    title: "Groups",
    url: "/groups",
    icon: Users2,
  },
  {
    title: "Social Accounts",
    url: "/social-accounts",
    icon: AtSign,
    subItems: [
      {
        title: "Account Matching",
        url: "/account-matching",
        icon: Link2,
      },
    ],
  },
  {
    title: "Social Graph",
    url: "/social-graph-3d",
    icon: Share2,
  },
  {
    title: "Daily Notes",
    url: "/daily-notes",
    icon: BookOpen,
  },
  {
    title: "Images",
    url: "/images",
    icon: Image,
  },
  {
    title: "ELO Ranking",
    url: "/elo-ranking",
    icon: Trophy,
  },
  {
    title: "Demos",
    url: "/demos",
    icon: Sparkles,
    subItems: [
      {
        title: "PRM Face Demo",
        url: "/prm-face-demo",
        icon: Scan,
      },
      {
        title: "PRM Face Save Demo",
        url: "/prm-face-save-demo",
        icon: Scan,
      },
      {
        title: "AI Description Demo",
        url: "/ai-desc-demo",
        icon: Sparkles,
      },
      {
        title: "Chat",
        url: "/ai-chat-demo",
        icon: MessagesSquare,
      },
    ],
  },
];

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | "system" | null;
    const initialTheme = savedTheme || "system";
    setTheme(initialTheme);
    const effective = initialTheme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : initialTheme;
    document.documentElement.classList.toggle("dark", effective === "dark");
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const effective = mql.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", effective === "dark");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const handleThemeToggle = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    const effective = next === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : next;
    document.documentElement.classList.toggle("dark", effective === "dark");
  };

  const handleSettingsClick = () => {
    navigate("/settings");
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>PRM 2.0</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.subItems?.some(sub => location === sub.url) ?? false)}
                    tooltip={item.title}
                  >
                    <Link
                      href={item.url}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.subItems && (
                    <SidebarMenuSub>
                      {item.subItems.map((sub) => (
                        <SidebarMenuSubItem key={sub.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location === sub.url}
                          >
                            <Link
                              href={sub.url}
                              data-testid={`link-${sub.title.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <sub.icon className="h-4 w-4" />
                              <span>{sub.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator className="md:hidden" />
      <SidebarFooter className="md:hidden">
        <SidebarMenu>
          {user && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleSettingsClick}
                isActive={location.startsWith("/settings")}
                tooltip="Settings"
                data-testid="sidebar-button-settings"
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleThemeToggle}
              tooltip={theme === "system" ? "System theme" : theme === "light" ? "Dark mode" : "Light mode"}
              data-testid="sidebar-button-theme"
            >
              {theme === "system" ? <Monitor /> : theme === "light" ? <Moon /> : <Sun />}
              <span>{theme === "system" ? "System theme" : theme === "light" ? "Dark mode" : "Light mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {user && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                tooltip="Log out"
                data-testid="sidebar-button-logout"
              >
                <LogOut />
                <span>Log out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
