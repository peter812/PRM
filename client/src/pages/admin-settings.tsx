import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ROLE_LABELS, type User, type UserRole } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Users, ChevronRight, Eye } from "lucide-react";

type SafeUser = Omit<User, "password">;
type AdminViewState = { isAdmin: boolean; isSuperAdmin: boolean; enabled: boolean };

export default function AdminSettingsPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: adminView } = useQuery<AdminViewState>({ queryKey: ["/api/admin/view"] });

  const viewMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/admin/view", { enabled });
      return res.json();
    },
    onSuccess: (state: AdminViewState) => {
      // Every cached list was fetched under the *old* visibility rules, so the
      // whole cache is stale the moment this flips.
      globalQueryClient.clear();
      queryClient.setQueryData(["/api/admin/view"], state);
      toast({
        title: state.enabled ? "Cross-user view is on" : "Cross-user view is off",
        description: state.enabled
          ? "You are now seeing every user's private notes, daily notes, tasks and DM threads."
          : "You are back to seeing only your own private data.",
      });
    },
    onError: (error: Error) =>
      toast({ title: "Could not change view", description: error.message, variant: "destructive" }),
  });

  const myRole = (me?.role ?? "user") as UserRole;
  const roleCounts = (users ?? []).reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-admin-settings-title">
          <ShieldCheck className="h-6 w-6" />
          Admin
        </h1>
        <p className="text-muted-foreground">
          Instance-wide settings. You are signed in as{" "}
          <span className="font-medium text-foreground">{ROLE_LABELS[myRole]}</span>.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              Users
            </CardTitle>
            <CardDescription>Create accounts, change roles, and remove access.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Badge variant="default">{roleCounts.super_admin ?? 0} super admin</Badge>
                <Badge variant="secondary">{roleCounts.admin ?? 0} admin</Badge>
                <Badge variant="outline">{roleCounts.user ?? 0} user</Badge>
              </div>
            )}
            <Link
              href="/admin/users"
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
              data-testid="link-manage-users"
            >
              <div>
                <h4 className="text-sm font-semibold">Manage users</h4>
                <p className="text-xs text-muted-foreground">
                  There is no open registration — accounts are only created here.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Eye className="h-5 w-5 text-muted-foreground" />
              Cross-user view
            </CardTitle>
            <CardDescription>
              Read every user's private data — notes, daily notes, tasks, and DM threads — instead of
              only your own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4 p-3 rounded-lg border">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {adminView?.enabled ? "On — you are reading as an admin" : "Off — reading as yourself"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Off by default every session. Being an admin is not the same as reading as one, so
                  this has to be switched on deliberately, and every toggle is written to the server
                  log.
                </p>
              </div>
              <Switch
                checked={adminView?.enabled ?? false}
                onCheckedChange={(checked) => viewMutation.mutate(checked)}
                disabled={viewMutation.isPending}
                data-testid="switch-admin-view"
              />
            </div>
            {adminView?.enabled && (
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-3">
                While this is on, lists across the app include other people's private rows.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Roles</CardTitle>
            <CardDescription>What each role can do on this instance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-3">
              <Badge variant="outline" className="shrink-0 h-fit">User</Badge>
              <p className="text-muted-foreground">
                Reads and writes shared contacts, groups and interactions. Their notes, daily notes
                and tasks are private to them.
              </p>
            </div>
            <div className="flex gap-3">
              <Badge variant="secondary" className="shrink-0 h-fit">Admin</Badge>
              <p className="text-muted-foreground">
                Everything a user can do, plus creating accounts, changing roles, editing lookup
                tables and instance settings, and turning on cross-user view.
              </p>
            </div>
            <div className="flex gap-3">
              <Badge variant="default" className="shrink-0 h-fit">Super Admin</Badge>
              <p className="text-muted-foreground">
                The instance owner. Everything an admin can do, and only a super admin can create or
                modify another super admin — an ordinary admin cannot change their role, reset their
                password, or delete them. An instance always keeps at least one.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
