import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { ArrowLeft, User, Settings, Book, Key, Trash2, FolderSync, Users, Share2, Database, ChevronRight, Camera, ImageIcon, ListTodo, Layers, HardDrive, Chrome, Scan, ScanFace, Network, Table2, BrainCircuit, Wrench, Plug, Sparkles } from "lucide-react";
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
import ExperimentalFeaturesPage from "@/pages/experimental-features";
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
import InstagramXmlTransferPage from "@/pages/instagram-xml-transfer";
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
      { title: "API Settings", url: "/settings/api-settings", icon: Key },
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
    location === "/settings/api-settings" ||
    location === "/settings/experimental";
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
        <Route path="/api-settings" component={ApiSettingsPage} />
        <Route path="/chrome-extension" component={ChromeExtensionSettingsPage} />
        <Route path="/api" component={ApiDocs} />
        <Route path="/delete" component={DeleteOptionsPage} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}
