import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { useState, useEffect, useRef } from "react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Settings, LogOut } from "lucide-react";
import PeopleList from "@/pages/people-list";
import PersonProfile from "@/pages/person-profile";
import MeProfile from "@/pages/me-profile";
import HomePage from "@/pages/home";
import GroupsList from "@/pages/groups-list";
import GroupProfile from "@/pages/group-profile";
import SocialAccountsList from "@/pages/social-accounts-list";
import SocialAccountProfile from "@/pages/social-account-profile";
import Graph from "@/pages/graph";
import SocialGraph3D from "@/pages/social-graph-3d";
import AuthPage from "@/pages/auth-page";
import AuthDirectPage from "@/pages/auth-direct";
import WelcomePage from "@/pages/welcome-page";
import SettingsLayout from "@/pages/settings-layout";
import EloRanking from "@/pages/elo-ranking";
import GuessTheSex from "@/pages/guess-the-sex";
import AccountMatching from "@/pages/account-matching";
import PrmFaceDemo from "@/pages/prm-face-demo";
import PrmFaceSaveDemo from "@/pages/prm-face-save-demo";
import AiDescDemo from "@/pages/ai-desc-demo";
import AiChatDemo from "@/pages/ai-chat-demo";
import DemosPage from "@/pages/demos";
import GamesPage from "@/pages/games";
import ImageDetailPage from "@/pages/image-detail";
import ImagesListPage from "@/pages/images-list";
import DailyNotesList from "@/pages/daily-notes";
import DailyNoteDetail from "@/pages/daily-note-detail";
import SuperSearchPage from "@/pages/super-search";
import FamilyTreePage from "@/pages/family-tree";
import FamilyTreeDevPage from "@/pages/family-tree-dev";
import NotFound from "@/pages/not-found";

const SEEN_EXPORTS_KEY = "seen_completed_export_task_ids";

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

  const { data: tasks } = useQuery<{ id: string; type: string; status: string }[]>({
    queryKey: ["/api/tasks"],
    enabled: !!user,
    refetchInterval: 5000,
    select: (data) => data.map(t => ({ id: t.id, type: t.type, status: t.status })),
  });

  useEffect(() => {
    if (!tasks) return;
    const newlySeen: string[] = [];
    for (const task of tasks) {
      if (task.type === "export_xml" && task.status === "completed" && !seenRef.current.has(task.id)) {
        seenRef.current.add(task.id);
        newlySeen.push(task.id);
        toast({
          title: "Export ready",
          description: "Your XML export is complete. Find the download button in the Tasks list.",
        });
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

function Router() {
  return (
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
      <ProtectedRoute path="/group/:id" component={GroupProfile} />
      <ProtectedRoute path="/social-accounts" component={SocialAccountsList} />
      <ProtectedRoute path="/social-accounts/:uuid" component={SocialAccountProfile} />
      <ProtectedRoute path="/graph" component={Graph} />
      <ProtectedRoute path="/graph-3d" component={GraphRedirect} />
      <ProtectedRoute path="/social-graph-3d" component={SocialGraph3D} />
      <ProtectedRoute path="/family-tree" component={FamilyTreePage} />
      <ProtectedRoute path="/family-tree-dev-version" component={FamilyTreeDevPage} />
      <ProtectedRoute path="/elo-ranking" component={EloRanking} />
      <ProtectedRoute path="/guess-the-sex" component={GuessTheSex} />
      <ProtectedRoute path="/account-matching" component={AccountMatching} />
      <ProtectedRoute path="/demos" component={DemosPage} />
      <ProtectedRoute path="/games" component={GamesPage} />
      <ProtectedRoute path="/prm-face-demo" component={PrmFaceDemo} />
      <ProtectedRoute path="/prm-face-save-demo" component={PrmFaceSaveDemo} />
      <ProtectedRoute path="/ai-desc-demo" component={AiDescDemo} />
      <ProtectedRoute path="/ai-chat-demo" component={AiChatDemo} />
      <ProtectedRoute path="/image/:id" component={ImageDetailPage} />
      <ProtectedRoute path="/images" component={ImagesListPage} />
      <ProtectedRoute path="/daily-notes" component={DailyNotesList} />
      <ProtectedRoute path="/daily-notes/:id" component={DailyNoteDetail} />
      <ProtectedRoute path="/super-search" component={SuperSearchPage} />
      <ProtectedRoute path="/settings" nest component={SettingsLayout} />
      <Route component={NotFound} />
    </Switch>
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
  useExportNotifier();
  const isAuthPage = location === "/auth" || location === "/auth-direct";
  const isWelcomePage = location === "/welcome";
  const isSettingsPage = location.startsWith("/settings");

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

  if (isAuthPage || isWelcomePage || isSettingsPage) {
    return <Router />;
  }

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
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
                  />
                  <div className="hidden md:flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => navigate("/settings")}
                      data-testid="header-button-settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
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
