import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { toast } from "@/hooks/use-toast";
import { GlobalSearch } from "@/components/global-search";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PersonDialog } from "@/components/person-dialog";
import { SocialAccountDialog } from "@/components/social-account-dialog";
import { RelationshipDialog } from "@/components/relationship-dialog";
import { DailyNoteModal } from "@/components/daily-note-modal";
import { InteractionDialog } from "@/components/interaction-dialog";
import { AddNoteDialog } from "@/components/add-note-dialog";
import { UniversalAddButton } from "@/components/universal-add-button";
import { PhotoUploadDialog } from "@/components/photo-upload-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { BubblesBackground } from "@/components/bubbles-background";
import { TaskTrackerModal } from "@/components/task-tracker-modal";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, Home, Loader2 } from "lucide-react";
import { SettingsSidebar } from "@/pages/settings-layout";

const PeopleList = lazy(() => import("@/pages/people-list"));
const PersonProfile = lazy(() => import("@/pages/person-profile"));
const MeProfile = lazy(() => import("@/pages/me-profile"));
const HomePage = lazy(() => import("@/pages/home"));
const GroupsList = lazy(() => import("@/pages/groups-list"));
const GroupProfile = lazy(() => import("@/pages/group-profile"));
const SubGroupProfile = lazy(() => import("@/pages/subgroup-profile"));
const PotentialGroupsPage = lazy(() => import("@/pages/potential-groups"));
const SocialAccountsList = lazy(() => import("@/pages/social-accounts-list"));
const SocialAccountProfile = lazy(() => import("@/pages/social-account-profile"));
const Graph = lazy(() => import("@/pages/graph"));
const SocialGraph3D = lazy(() => import("@/pages/social-graph-3d"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const AuthDirectPage = lazy(() => import("@/pages/auth-direct"));
const WelcomePage = lazy(() => import("@/pages/welcome-page"));
const SettingsLayout = lazy(() => import("@/pages/settings-layout"));
const EloRanking = lazy(() => import("@/pages/elo-ranking"));
const GuessTheSex = lazy(() => import("@/pages/guess-the-sex"));
const AccountMatching = lazy(() => import("@/pages/account-matching"));
const PrmFaceDemo = lazy(() => import("@/pages/prm-face-demo"));
const PrmFaceSaveDemo = lazy(() => import("@/pages/prm-face-save-demo"));
const UnknownFaces = lazy(() => import("@/pages/unknown-faces"));
const AiDescDemo = lazy(() => import("@/pages/ai-desc-demo"));
const OcrDemo = lazy(() => import("@/pages/ocr-demo"));
const AiChatDemo = lazy(() => import("@/pages/ai-chat-demo"));
const DemosPage = lazy(() => import("@/pages/demos"));
const OsintDemoPage = lazy(() => import("@/pages/osint-demo"));
const GamesPage = lazy(() => import("@/pages/games"));
const DescribeMePage = lazy(() => import("@/pages/describe-me"));
const PoliticalLeaningGamePage = lazy(() => import("@/pages/political-leaning-game"));
const ImageDetailPage = lazy(() => import("@/pages/image-detail"));
const ImagesListPage = lazy(() => import("@/pages/images-list"));
const DailyNotesList = lazy(() => import("@/pages/daily-notes"));
const DailyNoteDetail = lazy(() => import("@/pages/daily-note-detail"));
const SuperSearchPage = lazy(() => import("@/pages/super-search"));
const FamilyTreePage = lazy(() => import("@/pages/family-tree"));
const PendingSocialImportsPage = lazy(() => import("@/pages/pending-social-imports"));
const SocialTrackingPage = lazy(() => import("@/pages/social-tracking"));
const NotFound = lazy(() => import("@/pages/not-found"));


const SEEN_EXPORTS_KEY = "seen_completed_export_task_ids";

/** True when `src` is a presigned S3 URL whose X-Amz-Date + X-Amz-Expires window has passed. */
function isExpiredSignedUrl(src: string): boolean {
  if (!src.includes("X-Amz-Signature")) return false;
  try {
    const params = new URL(src, window.location.href).searchParams;
    const d = params.get("X-Amz-Date");
    const expires = Number(params.get("X-Amz-Expires"));
    if (!d || d.length !== 16 || !expires) return false;
    const signedAt = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));
    return Date.now() > signedAt + expires * 1000 - 60_000;
  } catch {
    return false;
  }
}

/**
 * PRM-S3 direct mode hands the browser presigned media URLs inside API
 * responses. If a long-lived tab tries to render one after it has expired,
 * refetch the data so the server issues fresh URLs (throttled so a page full
 * of stale images triggers a single refetch).
 */
function useSignedMediaRefresh() {
  useEffect(() => {
    let lastRefetch = 0;
    const onError = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || !["IMG", "VIDEO", "AUDIO", "SOURCE"].includes(el.tagName)) return;
      const src = (el as HTMLMediaElement).currentSrc || (el as HTMLImageElement).src || "";
      if (!isExpiredSignedUrl(src)) return;
      const now = Date.now();
      if (now - lastRefetch < 30_000) return;
      lastRefetch = now;
      queryClient.invalidateQueries();
    };
    // Media error events don't bubble; capture them at the document.
    document.addEventListener("error", onError, true);
    return () => document.removeEventListener("error", onError, true);
  }, []);
}

function useExportNotifier() {
  const { user } = useAuth();
  const seenRef = useRef<Set<string>>(new Set());

  // Seed from localStorage on mount so we don't re-notify after a page reload
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SEEN_EXPORTS_KEY) || "[]");
      if (Array.isArray(stored)) seenRef.current = new Set(stored);
    } catch {}
  }, []);

  const { data: tasks } = useQuery<{ id: string; type: string; status: string; result?: string }[]>({
    queryKey: ["/api/tasks/current"],
    enabled: !!user,
    refetchInterval: 4000,
    select: (data) => data.map(t => ({ id: t.id, type: t.type, status: t.status, result: (t as any).result })),
  });

  useEffect(() => {
    if (!tasks) return;
    const newlySeen: string[] = [];
    for (const task of tasks) {
      if (task.type === "export_xml" && task.status === "completed" && !seenRef.current.has(task.id)) {
        seenRef.current.add(task.id);
        newlySeen.push(task.id);
        const filename = task.result ? task.result.replace(/^(backups|exports)\//, "") : "Backup";
        toast({
          title: "Backup Complete",
          description: `Backup "${filename}" has finished creation and is ready in Backups.`,
        });

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("Backup Finished", {
              body: `Backup "${filename}" has finished creation.`,
              icon: "/favicon.png",
            });
          } catch {}
        }

        queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      }
    }
    if (newlySeen.length > 0) {
      try {
        localStorage.setItem(SEEN_EXPORTS_KEY, JSON.stringify([...seenRef.current]));
      } catch {}
    }
  }, [tasks]);
}

function GraphRedirect() {
  const params = new URLSearchParams(window.location.search);
  const personUuid = params.get("personUuid");
  const groupUuid = params.get("groupUuid");
  const search = new URLSearchParams();
  search.set("view", "person");
  if (personUuid) search.set("selected", personUuid);
  if (groupUuid && !personUuid) search.set("highlightGroup", groupUuid);
  return <Redirect to={`/social-graph-3d?${search.toString()}`} replace />;
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full w-full min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Switch>
        <Route path="/welcome" component={WelcomePage} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/auth-direct" component={AuthDirectPage} />
        <ProtectedRoute path="/" component={PeopleList} />
        <ProtectedRoute path="/people" component={PeopleList} />
        <ProtectedRoute path="/person/:id" component={PersonProfile} />
        <ProtectedRoute path="/home" component={HomePage} />
        <ProtectedRoute path="/me" component={MeProfile} />
        <ProtectedRoute path="/groups" component={GroupsList} />
        <ProtectedRoute path="/groups/potential" component={PotentialGroupsPage} />
        <ProtectedRoute path="/group/:groupId/subgroup/:subGroupId" component={GroupProfile} />
        <ProtectedRoute path="/subgroup/:id" component={SubGroupProfile} />
        <ProtectedRoute path="/group/:id" component={GroupProfile} />
        <ProtectedRoute path="/social-accounts" component={SocialAccountsList} />
        <ProtectedRoute path="/social-accounts/pending-imports" component={PendingSocialImportsPage} />
        <ProtectedRoute path="/social-accounts/tracking" component={SocialTrackingPage} />
        <ProtectedRoute path="/social-accounts/:uuid" component={SocialAccountProfile} />
        <ProtectedRoute path="/graph" component={Graph} />
        <ProtectedRoute path="/graph-3d" component={GraphRedirect} />
        <ProtectedRoute path="/social-graph-3d" component={SocialGraph3D} />
        <ProtectedRoute path="/family-tree" component={FamilyTreePage} />
        <ProtectedRoute path="/elo-ranking" component={EloRanking} />
        <ProtectedRoute path="/guess-the-sex" component={GuessTheSex} />
        <ProtectedRoute path="/account-matching" component={AccountMatching} />
        <ProtectedRoute path="/demos" component={DemosPage} />
        <ProtectedRoute path="/demos/osint/:tool" component={OsintDemoPage} />
        <ProtectedRoute path="/games" component={GamesPage} />
        <ProtectedRoute path="/describe-me" component={DescribeMePage} />
        <ProtectedRoute path="/games/political-leaning" component={PoliticalLeaningGamePage} />
        <ProtectedRoute path="/political-leaning-game" component={PoliticalLeaningGamePage} />
        <ProtectedRoute path="/prm-face-demo" component={PrmFaceDemo} />
        <ProtectedRoute path="/prm-face-save-demo" component={PrmFaceSaveDemo} />
        <ProtectedRoute path="/unknown-faces" component={UnknownFaces} />
        <ProtectedRoute path="/ai-desc-demo" component={AiDescDemo} />
        <ProtectedRoute path="/ocr-demo" component={OcrDemo} />
        <ProtectedRoute path="/demos/ocr" component={OcrDemo} />
        <ProtectedRoute path="/ai-chat-demo/:id?" component={AiChatDemo} />
        <ProtectedRoute path="/image/:id" component={ImageDetailPage} />
        <ProtectedRoute path="/images" component={ImagesListPage} />
        <ProtectedRoute path="/daily-notes" component={DailyNotesList} />
        <ProtectedRoute path="/daily-notes/:id" component={DailyNoteDetail} />
        <ProtectedRoute path="/super-search" component={SuperSearchPage} />
        <ProtectedRoute path="/backups" component={() => <Redirect to="/settings/import-export/backups" />} />
        <ProtectedRoute path="/import-export" component={() => <Redirect to="/settings/import-export" />} />
        <ProtectedRoute path="/import-export/backups" component={() => <Redirect to="/settings/import-export/backups" />} />
        <ProtectedRoute path="/import-export/contacts" component={() => <Redirect to="/settings/import-export/contacts" />} />
        <ProtectedRoute path="/import-export/social-media" component={() => <Redirect to="/settings/import-export/social-media" />} />
        <ProtectedRoute path="/import-export/messages" component={() => <Redirect to="/settings/import-export/messages" />} />
        <ProtectedRoute path="/import-export/extension-imports" component={() => <Redirect to="/settings/import-export/extension-imports" />} />
        <ProtectedRoute path="/import-export/instagram-xml" component={() => <Redirect to="/settings/import-export" />} />
        <ProtectedRoute path="/import-export/image-pass-in" component={() => <Redirect to="/settings/import-export/image-pass-in" />} />
        <ProtectedRoute path="/import-export/application" component={() => <Redirect to="/settings/import-export/backups" />} />
        <ProtectedRoute path="/osint" component={() => <Redirect to="/settings/osint" />} />
        <ProtectedRoute path="/settings/social-accounts/:uuid*" component={({ params }) => {
          const search = typeof window !== "undefined" ? window.location.search : "";
          return <Redirect to={`/social-accounts/${(params as any)?.uuid || ""}${search}`} replace />;
        }} />
        <ProtectedRoute path="/settings" nest component={SettingsLayout} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppLayout() {
  const [location, navigate] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [isAddPersonDialogOpen, setIsAddPersonDialogOpen] = useState(false);
  const [isAddSocialAccountDialogOpen, setIsAddSocialAccountDialogOpen] = useState(false);
  const [isAddRelationshipDialogOpen, setIsAddRelationshipDialogOpen] = useState(false);
  const [isAddDailyNoteDialogOpen, setIsAddDailyNoteDialogOpen] = useState(false);
  const [isAddInteractionDialogOpen, setIsAddInteractionDialogOpen] = useState(false);
  const [isAddNoteDialogOpen, setIsAddNoteDialogOpen] = useState(false);
  const [isAddPhotoDialogOpen, setIsAddPhotoDialogOpen] = useState(false);
  useExportNotifier();
  useSignedMediaRefresh();
  const isAuthPage = location === "/auth" || location === "/auth-direct";
  const isWelcomePage = location === "/welcome";
  const isSettingsPage = location.startsWith("/settings");

  const [lastNonSettingsPath, setLastNonSettingsPath] = useState(() => {
    return localStorage.getItem("lastNonSettingsPath") || "/home";
  });

  useEffect(() => {
    if (!isSettingsPage && !isAuthPage && !isWelcomePage) {
      localStorage.setItem("lastNonSettingsPath", location);
      setLastNonSettingsPath(location);
    }
  }, [location, isSettingsPage, isAuthPage, isWelcomePage]);

  // Check if setup is needed
  const { data: setupStatus } = useQuery<{ isSetupNeeded: boolean }>({
    queryKey: ["/api/setup/status"],
    enabled: !isWelcomePage && !isAuthPage && !isSettingsPage,
  });

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Redirect to welcome page if setup is needed
  if (setupStatus?.isSetupNeeded && !isWelcomePage) {
    return <Redirect to="/welcome" />;
  }

  if (isAuthPage || isWelcomePage) {
    return <Router />;
  }

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <BubblesBackground />
      <div className="flex h-screen w-full">
        {isSettingsPage ? <SettingsSidebar /> : <AppSidebar />}
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center gap-3 px-3 py-2 border-b">
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
            <div className="flex-1 min-w-0 flex justify-center">
              <GlobalSearch />
            </div>
            <div
              id="header-contextual-actions"
              className="flex items-center gap-2 shrink-0"
              data-testid="contextual-actions"
            />
            <div className="flex items-center gap-1 shrink-0">
              {user && (
                <>
                  <UniversalAddButton
                    onAddPerson={() => setIsAddPersonDialogOpen(true)}
                    onAddSocialAccount={() => setIsAddSocialAccountDialogOpen(true)}
                    onAddRelationship={() => setIsAddRelationshipDialogOpen(true)}
                    onAddDailyNote={() => setIsAddDailyNoteDialogOpen(true)}
                    onAddInteraction={() => setIsAddInteractionDialogOpen(true)}
                    onAddNote={() => setIsAddNoteDialogOpen(true)}
                    onAddPhoto={() => setIsAddPhotoDialogOpen(true)}
                  />
                  <div className="hidden md:flex items-center gap-1">
                    {isSettingsPage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => navigate(lastNonSettingsPath)}
                        data-testid="header-button-home"
                      >
                        <Home className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => navigate("/settings")}
                        data-testid="header-button-settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    )}
                    <ThemeToggle />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => logoutMutation.mutate()}
                      disabled={logoutMutation.isPending}
                      data-testid="header-button-logout"
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
              {!user && (
                <div className="hidden md:flex items-center">
                  <ThemeToggle />
                </div>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-hidden pb-16 md:pb-0">
            <Router />
          </main>
        </div>
      </div>
      {user && (
        <>
          <MobileBottomNav onAddPersonClick={() => setIsAddPersonDialogOpen(true)} />
          <PersonDialog open={isAddPersonDialogOpen} onOpenChange={setIsAddPersonDialogOpen} />
          <SocialAccountDialog open={isAddSocialAccountDialogOpen} onOpenChange={setIsAddSocialAccountDialogOpen} />
          <RelationshipDialog open={isAddRelationshipDialogOpen} onOpenChange={setIsAddRelationshipDialogOpen} personId="" />
          <DailyNoteModal open={isAddDailyNoteDialogOpen} onOpenChange={setIsAddDailyNoteDialogOpen} />
          <InteractionDialog open={isAddInteractionDialogOpen} onOpenChange={setIsAddInteractionDialogOpen} />
          <AddNoteDialog open={isAddNoteDialogOpen} onOpenChange={setIsAddNoteDialogOpen} personId="" />
          <PhotoUploadDialog open={isAddPhotoDialogOpen} onClose={() => setIsAddPhotoDialogOpen(false)} />
          <TaskTrackerModal />
        </>
      )}
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <AppLayout />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
