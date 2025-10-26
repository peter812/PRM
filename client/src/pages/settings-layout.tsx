import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { ArrowLeft, User, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import UserOptionsPage from "@/pages/user-options";
import AppOptionsPage from "@/pages/app-options";
import NotFound from "@/pages/not-found";

const settingsMenuItems = [
  {
    title: "Back to Site",
    url: "/people",
    icon: ArrowLeft,
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
  },
];

function SettingsSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
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

export default function SettingsLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <SettingsSidebar />
        <main className="flex-1 overflow-auto">
          <Switch>
            <Route path="/settings" component={() => <Redirect to="/settings/user" />} />
            <Route path="/settings/user" component={UserOptionsPage} />
            <Route path="/settings/app" component={AppOptionsPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </SidebarProvider>
  );
}
