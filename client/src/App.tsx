import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings, Menu, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { GlobalSearch } from "@/components/global-search";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { AddPersonDialog } from "@/components/add-person-dialog";
import PeopleList from "@/pages/people-list";
import PersonProfile from "@/pages/person-profile";
import MeProfile from "@/pages/me-profile";
import GroupsList from "@/pages/groups-list";
import GroupProfile from "@/pages/group-profile";
import SocialAccountsList from "@/pages/social-accounts-list";
import SocialAccountProfile from "@/pages/social-account-profile";
import Graph from "@/pages/graph";
import Graph3D from "@/pages/graph-3d";
import ApiPlayground from "@/pages/api-playground";
import AuthPage from "@/pages/auth-page";
import AuthDirectPage from "@/pages/auth-direct";
import WelcomePage from "@/pages/welcome-page";
import SettingsLayout from "@/pages/settings-layout";
import DummyAuth from "@/pages/dummy-auth";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/auth-direct" component={AuthDirectPage} />
      <ProtectedRoute path="/" component={PeopleList} />
      <ProtectedRoute path="/people" component={PeopleList} />
      <ProtectedRoute path="/person/:id" component={PersonProfile} />
      <ProtectedRoute path="/me" component={MeProfile} />
      <ProtectedRoute path="/groups" component={GroupsList} />
      <ProtectedRoute path="/group/:id" component={GroupProfile} />
      <ProtectedRoute path="/social-accounts" component={SocialAccountsList} />
      <ProtectedRoute path="/social-accounts/:uuid" component={SocialAccountProfile} />
      <ProtectedRoute path="/graph" component={Graph} />
      <ProtectedRoute path="/graph-3d" component={Graph3D} />
      <ProtectedRoute path="/api-playground" component={ApiPlayground} />
      <ProtectedRoute path="/settings" component={SettingsLayout} />
      <ProtectedRoute path="/settings/:rest*" component={SettingsLayout} />
      <ProtectedRoute path="/dummy-auth" component={DummyAuth} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const [location, navigate] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isAddPersonDialogOpen, setIsAddPersonDialogOpen] = useState(false);
  const isAuthPage = location === "/auth" || location === "/auth-direct";
  const isWelcomePage = location === "/welcome";
  const isSettingsPage = location.startsWith("/settings");

  // Check if setup is needed
  const { data: setupStatus } = useQuery<{ isSetupNeeded: boolean }>({
    queryKey: ["/api/setup/status"],
    enabled: !isWelcomePage && !isAuthPage && !isSettingsPage,
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleSettingsClick = () => {
    navigate("/settings");
    setIsMenuOpen(false);
  };

  const handleThemeToggle = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

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
          <header className="flex items-center justify-between gap-2 px-4 py-2 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <GlobalSearch />
            {/* Desktop Menu - Hidden on mobile */}
            <div className="hidden md:flex items-center gap-2">
              {user && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSettingsClick}
                  data-testid="button-settings"
                  title="Settings"
                >
                  <Settings className="h-5 w-5" />
                </Button>
              )}
              <ThemeToggle />
              {user && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  disabled={logoutMutation.isPending}
                  data-testid="button-logout"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              )}
            </div>
            {/* Mobile Menu - Visible only on mobile */}
            <div className="flex md:hidden items-center gap-2">
              {user && (
                <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" data-testid="menu-mobile-options">
                    <DropdownMenuItem onClick={handleSettingsClick} data-testid="menu-settings">
                      <Settings className="h-4 w-4 mr-2" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleThemeToggle} data-testid="menu-theme">
                      {theme === "light" ? (
                        <Moon className="h-4 w-4 mr-2" />
                      ) : (
                        <Sun className="h-4 w-4 mr-2" />
                      )}
                      <span>Theme</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      disabled={logoutMutation.isPending}
                      data-testid="menu-logout"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      <span>Logout</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
          <AddPersonDialog open={isAddPersonDialogOpen} onOpenChange={setIsAddPersonDialogOpen} />
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
