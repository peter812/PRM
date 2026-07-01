import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { ArrowLeft, User, Settings, Book, Key, Trash2, FolderSync, Users, Share2, Database, ChevronRight, Camera, ImageIcon, ListTodo, Layers, HardDrive, Chrome, Scan, ScanFace, Network, Table2, BrainCircuit, Wrench, Plug, Sparkles, Loader2 } from "lucide-react";
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
import { lazy, Suspense } from "react";

const UserOptionsPage = lazy(() => import("@/pages/user-options"));
const AppOptionsPage = lazy(() => import("@/pages/app-options"));
const ExperimentalFeaturesPage = lazy(() => import("@/pages/experimental-features"));
const DataTypesPage = lazy(() => import("@/pages/data-types"));
const ApiSettingsPage = lazy(() => import("@/pages/api-settings"));
const ChromeExtensionSettingsPage = lazy(() => import("@/pages/chrome-extension-settings"));
const ApiDocs = lazy(() => import("@/pages/api-docs"));
const DeleteOptionsPage = lazy(() => import("@/pages/delete-options"));
const ImportExportHome = lazy(() => import("@/pages/import-export-home"));
const ImportContactsPage = lazy(() => import("@/pages/import-contacts"));
const ImportSocialMediaPage = lazy(() => import("@/pages/import-social-media"));
const ImportExportApplicationPage = lazy(() => import("@/pages/import-export-application"));
const ImagePassInPage = lazy(() => import("@/pages/image-pass-in"));
const InstagramXmlTransferPage = lazy(() => import("@/pages/instagram-xml-transfer"));
const TasksSettingsPage = lazy(() => import("@/pages/tasks-settings"));
const ImageStorageSettingsPage = lazy(() => import("@/pages/image-storage-settings"));
const ImageTablePage = lazy(() => import("@/pages/image-table-page"));
const ImageTasksSettingsPage = lazy(() => import("@/pages/image-tasks-settings"));
const RecognitionSettingsPage = lazy(() => import("@/pages/recognition-settings"));
const RecognitionImagesPage = lazy(() => import("@/pages/recognition-images"));
const RecognitionFacesPage = lazy(() => import("@/pages/recognition-faces"));
const SocialGraphSettingsPage = lazy(() => import("@/pages/social-graph-settings"));
const IntelligenceSettingsPage = lazy(() => import("@/pages/intelligence-settings"));
const IntelligenceToolsSettingsPage = lazy(() => import("@/pages/intelligence-tools-settings"));
const IntelligenceExternalToolsSettingsPage = lazy(() => import("@/pages/intelligence-external-tools-settings"));
const IntelligenceImagesSettingsPage = lazy(() => import("@/pages/intelligence-images-settings"));
const IntelligenceFamilyTreeSettingsPage = lazy(() => import("@/pages/intelligence-family-tree-settings"));
const VectorSettingsPage = lazy(() => import("@/pages/vector-settings"));
const TaskDetailPage = lazy(() => import("@/pages/task-detail"));
const NotFound = lazy(() => import("@/pages/not-found"));

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
    subItems: [
      { title: "Social Graph", url: "/settings/social-graph", icon: Network },
      { title: "Chrome Extension", url: "/settings/chrome-extension", icon: Chrome },
      { title: "Experimental Features", url: "/settings/experimental", icon: Sparkles },
    ],
  },
  {
    title: "Data Types",
    url: "/settings/data-types",
    icon: Layers,
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
      { title: "Family Tree", url: "/settings/intelligence/family-tree", icon: Network },
      { title: "Vector Storage", url: "/settings/vector", icon: Database },
    ],
  },
  {
    title: "Tasks",
    url: "/settings/tasks",
    icon: ListTodo,
    subItems: [
      { title: "Image Tasks", url: "/settings/image-storage/tasks", icon: ImageIcon },
    ],
  },
  {
    title: "Import & Export",
    url: "/settings/import-export",
    icon: FolderSync,
    subItems: [
      { title: "Contacts", url: "/settings/import-export/contacts", icon: Users },
      { title: "Social Media", url: "/settings/import-export/social-media", icon: Share2 },
      { title: "Application Data", url: "/settings/import-export/application", icon: Database },
      { title: "Image Pass In", url: "/settings/import-export/image-pass-in", icon: ImageIcon },
      { title: "Instagram XML Transfer", url: "/settings/import-export/instagram-xml", icon: Camera },
    ],
  },
  {
    title: "Recognition",
    url: "/settings/recognition",
    icon: Scan,
    subItems: [
      { title: "Images", url: "/settings/recognition/images", icon: ImageIcon },
      { title: "Faces", url: "/settings/recognition/faces", icon: ScanFace },
    ],
  },
  {
    title: "API Documentation",
    url: "/settings/api",
    icon: Book,
    subItems: [
      { title: "API Settings", url: "/settings/api/settings", icon: Key },
    ],
  },
  {
    title: "Delete Options",
    url: "/settings/delete",
    icon: Trash2,
  },
];

export function SettingsSidebar() {
  const [location] = useLocation();

  const isDataTypesActive = location.startsWith("/settings/data-types");
  const isImportExportActive = location.startsWith("/settings/import-export") || location === "/settings/instagram";
  const isRecognitionActive = location.startsWith("/settings/recognition");
  const isAppOptionsActive =
    location.startsWith("/settings/app") ||
    location.startsWith("/settings/social-graph") ||
    location === "/settings/chrome-extension" ||
    location === "/settings/experimental";
  const isApiDocsActive = location.startsWith("/settings/api");
  const isImageStorageActive = location.startsWith("/settings/image-storage") && location !== "/settings/image-storage/tasks";
  const isIntelligenceActive = location.startsWith("/settings/intelligence") || location === "/settings/vector";
  const isTasksActive = location.startsWith("/settings/tasks") || location === "/settings/image-tasks" || location === "/settings/image-storage/tasks";

  function getIsActive(item: MenuItem): boolean {
    switch (item.url) {
      case "/settings/data-types": return isDataTypesActive;
      case "/settings/recognition": return isRecognitionActive;
      case "/settings/app": return isAppOptionsActive;
      case "/settings/image-storage": return isImageStorageActive;
      case "/settings/intelligence": return isIntelligenceActive;
      case "/settings/tasks": return isTasksActive;
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

export default function SettingsLayout() {
  return (
    <div className="flex-1 overflow-auto h-full">
      <Suspense fallback={
        <div className="flex items-center justify-center h-full w-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }>
        <Switch>
          <Route path="/" component={() => <Redirect to="/user" />} />
          <Route path="/user" component={UserOptionsPage} />
          <Route path="/app" component={AppOptionsPage} />
          <Route path="/experimental" component={ExperimentalFeaturesPage} />
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
          <Route path="/import-export/instagram-xml" component={InstagramXmlTransferPage} />
          <Route path="/instagram" component={() => <Redirect to="/import-export/instagram-xml" />} />
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
          <Route path="/chrome-extension" component={ChromeExtensionSettingsPage} />
          <Route path="/api/settings" component={ApiSettingsPage} />
          <Route path="/api" component={ApiDocs} />
          <Route path="/delete" component={DeleteOptionsPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </div>
  );
}
