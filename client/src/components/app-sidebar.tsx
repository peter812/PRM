import {
  Users,
  Users2,
  User,
  AtSign,
  Trophy,
  Share2,
  Link2,
  Settings,
  LogOut,
  Moon,
  Sun,
  Scan,
  Sparkles,
  MessagesSquare,
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
    title: "ELO Ranking",
    url: "/elo-ranking",
    icon: Trophy,
  },
  {
    title: "PRM-Face Demo",
    url: "/prm-face-demo",
    icon: Scan,
    subItems: [
      {
        title: "PRM-Face Save Demo",
        url: "/prm-face-save-demo",
        icon: Scan,
      },
    ],
  },
  {
    title: "AI desc demo",
    url: "/ai-desc-demo",
    icon: Sparkles,
  },
  {
    title: "AI Chat - Demo",
    url: "/ai-chat-demo",
    icon: MessagesSquare,
  },
];

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const initialTheme = savedTheme || "light";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  const handleThemeToggle = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
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
                    isActive={location === item.url}
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
      <SidebarSeparator />
      <SidebarFooter>
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
              tooltip={theme === "light" ? "Dark mode" : "Light mode"}
              data-testid="sidebar-button-theme"
            >
              {theme === "light" ? <Moon /> : <Sun />}
              <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
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
