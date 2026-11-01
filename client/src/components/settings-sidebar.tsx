import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  User,
  Settings,
  Book,
  Key,
  Trash2,
  FolderSync,
  Users,
  Database,
  ChevronRight,
  ImageIcon,
  ListTodo,
  Layers,
  HardDrive,
  Chrome,
  Scan,
  Network,
  Table2,
  BrainCircuit,
  Wrench,
  Plug,
  Sparkles,
  Search,
  Home,
  Archive,
  MessageSquare,
  Radar,
  Instagram,
  Server,
  History,
  Globe,
  Palette,
  ScrollText,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ComponentType } from "react";

export interface MenuItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  subItems?: { title: string; url: string; icon: ComponentType<{ className?: string }> }[];
}

export const settingsMenuItems: MenuItem[] = [
  {
    title: "Back to Site",
    url: "/people",
    icon: ArrowLeft,
  },
  {
    title: "Home",
    url: "/settings/home",
    icon: Home,
  },
  {
    title: "Unified Setup",
    url: "/settings/setup",
    icon: Sparkles,
  },
  {
    title: "User Options",
    url: "/settings/user",
    icon: User,
  },
  {
    title: "App Options",
    url: "/settings/app",
    icon: Settings,
    subItems: [
      { title: "Looks", url: "/settings/looks", icon: Palette },
      { title: "Social Graph", url: "/settings/social-graph", icon: Network },
      { title: "Chrome Extension", url: "/settings/chrome-extension", icon: Chrome },
      { title: "Search Options", url: "/settings/search", icon: Search },
      { title: "Maps", url: "/settings/maps", icon: Globe },
      { title: "Data Types", url: "/settings/data-types", icon: Layers },
      { title: "Delete Options", url: "/settings/delete", icon: Trash2 },
    ],
  },
  {
    title: "Image Storage",
    url: "/settings/image-storage",
    icon: HardDrive,
    subItems: [
      { title: "Storage", url: "/settings/image-storage", icon: HardDrive },
      { title: "Image Table", url: "/settings/image-storage/table", icon: Table2 },
    ],
  },
  {
    title: "Intelligence",
    url: "/settings/intelligence",
    icon: BrainCircuit,
    subItems: [
      { title: "Tools", url: "/settings/intelligence/tools", icon: Wrench },
      { title: "External Tools", url: "/settings/intelligence/external-tools", icon: Plug },
      { title: "Images", url: "/settings/intelligence/images", icon: ImageIcon },
      { title: "Prompts", url: "/settings/intelligence/prompts", icon: ScrollText },
      { title: "Vector Storage", url: "/settings/vector", icon: Database },
      { title: "OSINT", url: "/settings/osint", icon: Radar },
    ],
  },
  {
    title: "Tasks",
    url: "/settings/tasks",
    icon: ListTodo,
    subItems: [
      { title: "Image Tasks", url: "/settings/image-storage/tasks", icon: ImageIcon },
      { title: "Social Tasks", url: "/settings/tasks/social", icon: History },
      { title: "OSINT Tasks", url: "/settings/tasks/osint", icon: Radar },
      { title: "Summary Tasks", url: "/settings/tasks/summaries", icon: Sparkles },
    ],
  },
  {
    title: "Import & Export",
    url: "/settings/import-export",
    icon: FolderSync,
    subItems: [
      { title: "Contacts", url: "/settings/import-export/contacts", icon: Users },
      { title: "Messages", url: "/settings/import-export/messages", icon: MessageSquare },
      { title: "Extension Imports", url: "/settings/import-export/extension-imports", icon: Chrome },
      { title: "Backups", url: "/settings/import-export/backups", icon: Archive },
    ],
  },
  {
    title: "Instagram",
    url: "/settings/instagram",
    icon: Instagram,
    subItems: [
      { title: "Importers", url: "/settings/instagram", icon: Server },
      { title: "Tracking", url: "/settings/instagram/tracking", icon: Radar },
      { title: "Posts", url: "/settings/instagram/posts", icon: ImageIcon },
    ],
  },
  {
    title: "Recognition",
    url: "/settings/recognition",
    icon: Scan,
  },
  {
    title: "API Documentation",
    url: "/settings/api",
    icon: Book,
    subItems: [
      { title: "API Settings", url: "/settings/api/settings", icon: Key },
    ],
  },
];

export function SettingsSidebar() {
  const [location] = useLocation();

  const isImportExportActive = location.startsWith("/settings/import-export");
  const isInstagramActive = location.startsWith("/settings/instagram");
  const isAppOptionsActive =
    location.startsWith("/settings/app") ||
    location.startsWith("/settings/looks") ||
    location.startsWith("/settings/social-graph") ||
    location.startsWith("/settings/chrome-extension") ||
    location.startsWith("/settings/search") ||
    location.startsWith("/settings/maps") ||
    location.startsWith("/settings/data-types") ||
    location.startsWith("/settings/delete");
  const isApiDocsActive = location.startsWith("/settings/api");
  const isImageStorageActive = location.startsWith("/settings/image-storage") && location !== "/settings/image-storage/tasks";
  const isIntelligenceActive =
    location.startsWith("/settings/intelligence") ||
    location === "/settings/vector" ||
    location.startsWith("/settings/osint");
  const isTasksActive =
    location.startsWith("/settings/tasks") ||
    location === "/settings/social-tasks" ||
    location === "/settings/image-tasks" ||
    location === "/settings/image-storage/tasks";

  function getIsActive(item: MenuItem): boolean {
    switch (item.url) {
      case "/settings/app": return isAppOptionsActive;
      case "/settings/image-storage": return isImageStorageActive;
      case "/settings/intelligence": return isIntelligenceActive;
      case "/settings/tasks": return isTasksActive;
      case "/settings/instagram": return isInstagramActive;
      case "/settings/api": return isApiDocsActive;
      default: return isImportExportActive;
    }
  }

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsMenuItems.map((item) => {
                if (item.subItems) {
                  const isActive = getIsActive(item);
                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      open={isActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            asChild
                            isActive={location === item.url}
                          >
                            <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                              <item.icon />
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </Link>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={location === subItem.url}
                                >
                                  <Link href={subItem.url} data-testid={`link-${subItem.title.toLowerCase().replace(/\s+/g, '-')}`}>
                                    <subItem.icon className="h-4 w-4" />
                                    <span>{subItem.title}</span>
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
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
