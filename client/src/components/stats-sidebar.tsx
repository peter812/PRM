import { Link, useLocation } from "wouter";
import { ArrowLeft, LayoutDashboard, Users, MessagesSquare, ScanFace, Sparkles } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const statsMenuItems = [
  { title: "Overview", url: "/stats", icon: LayoutDashboard },
  { title: "People", url: "/stats/people", icon: Users },
  { title: "Messages & Notes", url: "/stats/messages", icon: MessagesSquare },
  { title: "Groups & Faces", url: "/stats/groups-faces", icon: ScanFace },
  { title: "Summaries & Stories", url: "/stats/summaries", icon: Sparkles },
];

export function StatsSidebar({ backPath }: { backPath: string }) {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Stats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href={backPath} data-testid="link-back-to-site">
                    <ArrowLeft />
                    <span>Back to Site</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {statsMenuItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-stats-${item.title.toLowerCase().replace(/\W+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
