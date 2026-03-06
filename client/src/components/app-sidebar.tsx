import { Users, Network, Users2, User, Code, Box, AtSign, Trophy, Share2, Link2 } from "lucide-react";
import { Link, useLocation } from "wouter";
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
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";

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
    title: "Graph (3D)",
    url: "/graph-3d",
    icon: Box,
  },
  {
    title: "ELO Ranking",
    url: "/elo-ranking",
    icon: Trophy,
  },
  {
    title: "API Playground",
    url: "/api-playground",
    icon: Code,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>PRM 2.0</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.subItems && (
                    <SidebarMenuSub>
                      {item.subItems.map((sub) => (
                        <SidebarMenuSubItem key={sub.title}>
                          <SidebarMenuSubButton asChild isActive={location === sub.url}>
                            <Link href={sub.url} data-testid={`link-${sub.title.toLowerCase().replace(/\s+/g, "-")}`}>
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
    </Sidebar>
  );
}
