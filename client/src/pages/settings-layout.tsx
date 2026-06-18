import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { ArrowLeft, User, Settings, Book, Key, Trash2, FolderSync, Users, Share2, Database, ChevronRight, Camera, ImageIcon, ListTodo, Layers, HardDrive, Chrome, Scan, ScanFace, Network, Table2, BrainCircuit, Wrench, Plug } from "lucide-react";
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
import DataTypesPage from "@/pages/data-types";
import ApiSettingsPage from "@/pages/api-settings";
import ChromeExtensionSettingsPage from "@/pages/chrome-extension-settings";
import ApiDocs from "@/pages/api-docs";
import DeleteOptionsPage from "@/pages/delete-options";
import ImportExportHome from "@/pages/import-export-home";
import ImportContactsPage from "@/pages/import-contacts";
import ImportSocialMediaPage from "@/pages/import-social-media";
import ImportExportApplicationPage from "@/pages/import-export-application";
import ImagePassInPage from "@/pages/image-pass-in";
import InstagramSettingsPage from "@/pages/instagram-settings";
import TasksSettingsPage from "@/pages/tasks-settings";
import ImageStorageSettingsPage from "@/pages/image-storage-settings";
import ImageTablePage from "@/pages/image-table-page";
import ImageTasksSettingsPage from "@/pages/image-tasks-settings";
import RecognitionSettingsPage from "@/pages/recognition-settings";
import RecognitionImagesPage from "@/pages/recognition-images";
import RecognitionFacesPage from "@/pages/recognition-faces";
import SocialGraphSettingsPage from "@/pages/social-graph-settings";
import IntelligenceSettingsPage from "@/pages/intelligence-settings";
import IntelligenceToolsSettingsPage from "@/pages/intelligence-tools-settings";
import IntelligenceExternalToolsSettingsPage from "@/pages/intelligence-external-tools-settings";
import IntelligenceImagesSettingsPage from "@/pages/intelligence-images-settings";
import IntelligenceFamilyTreeSettingsPage from "@/pages/intelligence-family-tree-settings";
import VectorSettingsPage from "@/pages/vector-settings";
import TaskDetailPage from "@/pages/task-detail";
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
    url: "~/people",
    icon: ArrowLeft,
  },
  {
    title: "User Options",
    url: "/user",
    icon: User,
  },
  {
    title: "App Options",
    url: "/app",
    icon: Settings,
    subItems: [
      { title: "Social Graph", url: "/social-graph", icon: Network },
      { title: "Chrome Extension", url: "/chrome-extension", icon: Chrome },
      { title: "API Settings", url: "/api-settings", icon: Key },
    ],
  },
  {
    title: "Data Types",
    url: "/data-types",
    icon: Layers,
  },
  {
    title: "Image Storage",
    url: "/image-storage",
    icon: HardDrive,
    subItems: [
      { title: "Storage", url: "/image-storage", icon: HardDrive },
      { title: "Image Table", url: "/image-storage/table", icon: Table2 },
    ],
  },
  {
    title: "Intelligence",
    url: "/intelligence",
    icon: BrainCircuit,
    subItems: [
      { title: "Tools", url: "/intelligence/tools", icon: Wrench },
      { title: "External Tools", url: "/intelligence/external-tools", icon: Plug },
      { title: "Images", url: "/intelligence/images", icon: ImageIcon },
      { title: "Family Tree", url: "/intelligence/family-tree", icon: Network },
      { title: "Vector Storage", url: "/vector", icon: Database },
    ],
  },
  {
    title: "Tasks",
    url: "/tasks",
    icon: ListTodo,
    subItems: [
      { title: "Image Tasks", url: "/image-storage/tasks", icon: ImageIcon },
    ],
  },
  {
    title: "Import & Export",
    url: "/import-export",
    icon: FolderSync,
    subItems: [
      { title: "Contacts", url: "/import-export/contacts", icon: Users },
      { title: "Social Media", url: "/import-export/social-media", icon: Share2 },
      { title: "Application Data", url: "/import-export/application", icon: Database },
      { title: "Image Pass In", url: "/import-export/image-pass-in", icon: ImageIcon },
      { title: "Instagram Settings", url: "/instagram", icon: Camera },
    ],
  },
  {
    title: "Recognition",
    url: "/recognition",
    icon: Scan,
    subItems: [
      { title: "Images", url: "/recognition/images", icon: ImageIcon },
      { title: "Faces", url: "/recognition/faces", icon: ScanFace },
    ],
  },
  {
    title: "API Documentation",
    url: "/api",
    icon: Book,
  },
  {
    title: "Delete Options",
    url: "/delete",
    icon: Trash2,
  },
];

function SettingsSidebar() {
  const [location] = useLocation();

  const isDataTypesActive = location.startsWith("/data-types");
  const isImportExportActive = location.startsWith("/import-export") || location === "/instagram";
  const isRecognitionActive = location.startsWith("/recognition");
  const isAppOptionsActive =
    location.startsWith("/app") ||
    location.startsWith("/social-graph") ||
    location === "/chrome-extension" ||
    location === "/api-settings";
  const isImageStorageActive = location.startsWith("/image-storage") && location !== "/image-storage/tasks";
  const isIntelligenceActive = location.startsWith("/intelligence") || location === "/vector";
  const isTasksActive = location.startsWith("/tasks") || location === "/image-tasks" || location === "/image-storage/tasks";

  function getIsActive(item: MenuItem): boolean {
    switch (item.url) {
      case "/data-types": return isDataTypesActive;
      case "/recognition": return isRecognitionActive;
      case "/app": return isAppOptionsActive;
      case "/image-storage": return isImageStorageActive;
      case "/intelligence": return isIntelligenceActive;
      case "/tasks": return isTasksActive;
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
              <Route path="/" component={() => <Redirect to="/user" />} />
              <Route path="/user" component={UserOptionsPage} />
              <Route path="/app" component={AppOptionsPage} />
              <Route path="/data-types" component={DataTypesPage} />
              <Route path="/image-tasks" component={ImageTasksSettingsPage} />
              <Route path="/image-storage/tasks" component={ImageTasksSettingsPage} />
              <Route path="/image-storage/table" component={ImageTablePage} />
              <Route path="/image-storage" component={ImageStorageSettingsPage} />
              <Route path="/intelligence/tools" component={IntelligenceToolsSettingsPage} />
              <Route path="/intelligence/external-tools" component={IntelligenceExternalToolsSettingsPage} />
              <Route path="/intelligence/images" component={IntelligenceImagesSettingsPage} />
              <Route path="/intelligence/family-tree" component={IntelligenceFamilyTreeSettingsPage} />
              <Route path="/intelligence" component={IntelligenceSettingsPage} />
              <Route path="/vector" component={VectorSettingsPage} />
              <Route path="/instagram" component={InstagramSettingsPage} />
              <Route path="/tasks" component={TasksSettingsPage} />
              <Route path="/task/:id" component={TaskDetailPage} />
              <Route path="/social-graph" component={SocialGraphSettingsPage} />
              <Route path="/recognition/images" component={RecognitionImagesPage} />
              <Route path="/recognition/faces" component={RecognitionFacesPage} />
              <Route path="/recognition" component={RecognitionSettingsPage} />
              <Route path="/import-export/contacts" component={ImportContactsPage} />
              <Route path="/import-export/social-media" component={ImportSocialMediaPage} />
              <Route path="/import-export/application" component={ImportExportApplicationPage} />
              <Route path="/import-export/image-pass-in" component={ImagePassInPage} />
              <Route path="/import-export" component={ImportExportHome} />
              <Route path="/api-settings" component={ApiSettingsPage} />
              <Route path="/chrome-extension" component={ChromeExtensionSettingsPage} />
              <Route path="/api" component={ApiDocs} />
              <Route path="/delete" component={DeleteOptionsPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
