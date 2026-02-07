import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { ArrowLeft, User, Settings, Heart, Book, MessageSquare, Key, AtSign, Trash2, FolderSync, Users, Share2, Database, ChevronRight } from "lucide-react";
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
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import UserOptionsPage from "@/pages/user-options";
import AppOptionsPage from "@/pages/app-options";
import RelationshipTypesList from "@/pages/relationship-types-list";
import InteractionTypesList from "@/pages/interaction-types-list";
import SocialAccountTypesList from "@/pages/social-account-types-list";
import ApiSettingsPage from "@/pages/api-settings";
import ApiDocs from "@/pages/api-docs";
import DeleteOptionsPage from "@/pages/delete-options";
import ImportExportHome from "@/pages/import-export-home";
import ImportContactsPage from "@/pages/import-contacts";
import ImportMessagesPage from "@/pages/import-messages";
import ImportSocialMediaPage from "@/pages/import-social-media";
import ImportExportApplicationPage from "@/pages/import-export-application";
import NotFound from "@/pages/not-found";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }[];
}

const settingsMenuItems: MenuItem[] = [
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
  {
    title: "Relationship Types",
    url: "/settings/relationship-types",
    icon: Heart,
  },
  {
    title: "Interaction Types",
    url: "/settings/interaction-types",
    icon: MessageSquare,
  },
  {
    title: "Social Account Types",
    url: "/settings/social-account-types",
    icon: AtSign,
  },
  {
    title: "Import & Export",
    url: "/settings/import-export",
    icon: FolderSync,
    subItems: [
      { title: "Contacts", url: "/settings/import-export/contacts", icon: Users },
      { title: "Messages", url: "/settings/import-export/messages", icon: MessageSquare },
      { title: "Social Media", url: "/settings/import-export/social-media", icon: Share2 },
      { title: "Application Data", url: "/settings/import-export/application", icon: Database },
    ],
  },
  {
    title: "API Settings",
    url: "/settings/api-settings",
    icon: Key,
  },
  {
    title: "API Documentation",
    url: "/settings/api",
    icon: Book,
  },
  {
    title: "Delete Options",
    url: "/settings/delete",
    icon: Trash2,
  },
];

function SettingsSidebar() {
  const [location] = useLocation();

  const isImportExportActive = location.startsWith("/settings/import-export");

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsMenuItems.map((item) => {
                if (item.subItems) {
                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      defaultOpen={isImportExportActive}
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

export default function SettingsLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <SettingsSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-2 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/settings" component={() => <Redirect to="/settings/user" />} />
              <Route path="/settings/user" component={UserOptionsPage} />
              <Route path="/settings/app" component={AppOptionsPage} />
              <Route path="/settings/relationship-types" component={RelationshipTypesList} />
              <Route path="/settings/interaction-types" component={InteractionTypesList} />
              <Route path="/settings/social-account-types" component={SocialAccountTypesList} />
              <Route path="/settings/import-export/contacts" component={ImportContactsPage} />
              <Route path="/settings/import-export/messages" component={ImportMessagesPage} />
              <Route path="/settings/import-export/social-media" component={ImportSocialMediaPage} />
              <Route path="/settings/import-export/application" component={ImportExportApplicationPage} />
              <Route path="/settings/import-export" component={ImportExportHome} />
              <Route path="/settings/api-settings" component={ApiSettingsPage} />
              <Route path="/settings/api" component={ApiDocs} />
              <Route path="/settings/delete" component={DeleteOptionsPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
