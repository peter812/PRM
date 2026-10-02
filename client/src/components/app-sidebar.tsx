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
  ScanText,
  Mic,
  TrendingUp,
  Map as MapIcon,
  Sparkles,
  MessagesSquare,
  MessageSquareText,
  BookOpen,
  Home,
  Image,
  HelpCircle,
  ScanFace,
  Gamepad2,
  ChevronRight,
  Inbox,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/use-auth";

const menuItems = [
  {
    title: "Home",
    url: "/home",
    icon: Home,
  },
  {
    title: "AI Chat",
    url: "/ai-chat-demo",
    icon: MessagesSquare,
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
    subItems: [
      {
        title: "Tree Visualizer",
        url: "/family-tree",
        icon: GitBranch,
      },
      {
        title: "Potential Families",
        url: "/family-tree/potential",
        icon: Users,
      },
    ],
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
      {
        title: "Pending Imports",
        url: "/social-accounts/pending-imports",
        icon: Inbox,
      },
      {
        title: "Tracking",
        url: "/social-accounts/tracking",
        icon: Activity,
      },
      {
        title: "Issues",
        url: "/social-accounts/issues",
        icon: AlertTriangle,
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
    title: "Faces",
    url: "/faces",
    icon: ScanFace,
  },
  {
    title: "Face review",
    url: "/face-review",
    icon: HelpCircle,
  },
  {
    title: "Games",
    url: "/games",
    icon: Gamepad2,
    subItems: [
      {
        title: "ELO Ranking",
        url: "/elo-ranking",
        icon: Trophy,
      },
      {
        title: "Guess the Sex",
        url: "/guess-the-sex",
        icon: HelpCircle,
      },
      {
        title: "Describe Me",
        url: "/describe-me",
        icon: MessageSquareText,
      },
    ],
  },
  {
    title: "Demos",
    url: "/demos",
    icon: Sparkles,
    subItems: [
      {
        title: "Images",
        url: "/images",
        icon: Image,
      },

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
        title: "OCR",
        url: "/ocr-demo",
        icon: ScanText,
      },
      {
        title: "Whisper",
        url: "/demos/whisper",
        icon: Mic,
      },
      {
        title: "Account Creation Timeline",
        url: "/demos/account-timeline",
        icon: TrendingUp,
      },
      {
        title: "Map",
        url: "/demos/map",
        icon: MapIcon,
      },
    ],
  },
];

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });
  const demosEnabled = settings?.experimental_demos_enabled === "true";

  const { data: faceReviewCounts } = useQuery<{ total: number }>({
    queryKey: ["/api/face-review/counts"],
    refetchInterval: 60_000,
  });
  const faceReviewTotal = faceReviewCounts?.total ?? 0;

  const { data: issues } = useQuery<{ open: number }>({
    queryKey: ["/api/account-issues/count"],
    refetchInterval: 60_000,
  });

  const { data: gitData } = useQuery<{ branch: string }>({
    queryKey: ["/api/git/branch"],
  });

  const displayedMenuItems = demosEnabled ? menuItems : menuItems.filter(item => item.title !== "Demos");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | "system" | null;
    const initialTheme = savedTheme || "system";
    setTheme(initialTheme);
    const effective = initialTheme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : initialTheme;
    document.documentElement.classList.toggle("dark", effective === "dark");
    window.dispatchEvent(new Event("theme-change"));
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const effective = mql.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", effective === "dark");
      window.dispatchEvent(new Event("theme-change"));
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
    window.dispatchEvent(new Event("theme-change"));
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
          <SidebarGroupLabel className="flex items-center gap-2">
            <span>PRM 2.0</span>
            {gitData?.branch && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-mono font-semibold tracking-wider uppercase border border-primary/20">
                <GitBranch className="h-2.5 w-2.5" />
                {gitData.branch}
              </span>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {displayedMenuItems.map((item) => {
                const isActive = location === item.url || (item.subItems?.some(sub => location === sub.url) ?? false);
                
                if (item.subItems) {
                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      defaultOpen={isActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            tooltip={item.title}
                          >
                            <Link
                              href={item.url}
                              data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <item.icon />
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </Link>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map((sub) => (
                              <SidebarMenuSubItem key={sub.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location === sub.url}
                                >
                                  <Link
                                    href={sub.url}
                                    data-testid={`link-${sub.title.toLowerCase().replace(/\\s+/g, "-")}`}
                                  >
                                    <sub.icon className="h-4 w-4" />
                                    <span>{sub.title}</span>
                                    {sub.title === "Issues" && (issues?.open ?? 0) > 0 && (
                                      <span className="ml-auto bg-primary text-primary-foreground text-[10px] font-bold h-5 min-w-5 px-1 flex items-center justify-center rounded-full" data-testid="badge-issues-count">
                                        {issues!.open}
                                      </span>
                                    )}
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        {item.title === "Face review" && faceReviewTotal > 0 && (
                          <span className="ml-auto bg-primary text-primary-foreground text-[10px] font-bold h-5 min-w-5 px-1 flex items-center justify-center rounded-full" data-testid="badge-face-review-count">
                            {faceReviewTotal > 99 ? "99+" : faceReviewTotal}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
              tooltip={
                theme === "system"
                  ? "System theme"
                  : theme === "light"
                  ? "Dark mode"
                  : "Light mode"
              }
              data-testid="sidebar-button-theme"
            >
              {theme === "system" ? (
                <Monitor />
              ) : theme === "light" ? (
                <Moon />
              ) : (
                <Sun />
              )}
              <span>
                {theme === "system"
                  ? "System theme"
                  : theme === "light"
                  ? "Dark mode"
                  : "Light mode"}
              </span>
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
