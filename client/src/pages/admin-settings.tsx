import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Shield, Eye, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function AdminSettingsPage() {
  const { user, isAdmin, adminView } = useAuth();
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-destructive/40">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <CardTitle>Access Denied</CardTitle>
            </div>
            <CardDescription>
              You must be an administrator to access this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleToggleAdminView = async (checked: boolean) => {
    setIsUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/admin/view", { enabled: checked });
      const data = await res.json();
      // Update the user query data in cache
      queryClient.setQueryData(["/api/user"], (prev: any) => ({
        ...prev,
        adminView: data.adminView,
      }));
      // Invalidate all queries so data re-fetches with the new scope
      await queryClient.invalidateQueries();
      toast({
        title: data.adminView ? "Admin Mode Enabled" : "Admin Mode Disabled",
        description: data.adminView
          ? "You now have full visibility across all users' data for this session."
          : "You are now viewing your normal user-scoped data.",
      });
    } catch (error) {
      toast({
        title: "Failed to update Admin Mode",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          Admin Settings
        </h1>
        <p className="text-muted-foreground">
          System administration and global visibility controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Admin View Mode</CardTitle>
                <Badge variant={adminView ? "default" : "outline"}>
                  {adminView ? "Active" : "Standard View"}
                </Badge>
              </div>
              <CardDescription>
                Bypasses multi-tenant ownership filters and reveals all private and shared data across all users in the system.
              </CardDescription>
            </div>
            <Switch
              id="admin-view-toggle"
              checked={adminView}
              disabled={isUpdating}
              onCheckedChange={handleToggleAdminView}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Important session behavior:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Admin View is <strong>disabled by default</strong> upon login for privacy and safety.</li>
              <li>Toggling Admin View applies immediately to this browser session.</li>
              <li>When enabled, all queries across People, Notes, Groups, Interactions, and Tasks return system-wide records.</li>
              <li>Logging out or ending your session automatically resets Admin View to disabled.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
