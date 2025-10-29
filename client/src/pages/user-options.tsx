import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { Eye, EyeOff } from "lucide-react";

const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  nickname: z.string().min(1, "Nickname is required"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  ssoEmail: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  // If newPassword is provided, currentPassword must also be provided
  if (data.newPassword && !data.currentPassword) {
    return false;
  }
  // If newPassword is provided, confirmPassword must match
  if (data.newPassword && data.newPassword !== data.confirmPassword) {
    return false;
  }
  return true;
}, {
  message: "Password validation failed",
  path: ["newPassword"],
});

const ssoConfigSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  authUrl: z.string().url("Must be a valid URL"),
  tokenUrl: z.string().url("Must be a valid URL"),
  userInfoUrl: z.string().url("Must be a valid URL"),
  redirectUrl: z.string().url("Must be a valid URL"),
  logoutUrl: z.string().optional(),
  userIdentifier: z.string().min(1).default("email"),
  scopes: z.string().min(1).default("openid"),
  authStyle: z.enum(["auto", "in_params", "in_header"]).default("auto"),
});

type UpdateUserForm = z.infer<typeof updateUserSchema>;
type SsoConfigForm = z.infer<typeof ssoConfigSchema>;

export default function UserOptionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showClientSecret, setShowClientSecret] = useState(false);
  const ssoFormInitialized = useRef(false);
  const userFormInitialized = useRef(false);

  const form = useForm<UpdateUserForm>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: "",
      nickname: "",
      username: "",
      ssoEmail: "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Fetch SSO config
  const { data: ssoConfig } = useQuery<{
    enabled: number;
    clientId: string;
    clientSecret: string;
    authUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    redirectUrl: string;
    logoutUrl: string;
    userIdentifier: string;
    scopes: string;
    authStyle: "auto" | "in_params" | "in_header";
  }>({
    queryKey: ['/api/sso-config'],
    enabled: !!user,
  });

  const ssoForm = useForm<SsoConfigForm>({
    resolver: zodResolver(ssoConfigSchema),
    defaultValues: {
      enabled: false,
      clientId: "",
      clientSecret: "",
      authUrl: "",
      tokenUrl: "",
      userInfoUrl: "",
      redirectUrl: "",
      logoutUrl: "",
      userIdentifier: "email",
      scopes: "openid",
      authStyle: "auto",
    },
  });

  // Update user form when user data loads (only once)
  useEffect(() => {
    if (user && !userFormInitialized.current) {
      userFormInitialized.current = true;
      form.reset({
        name: user.name || "",
        nickname: user.nickname || "",
        username: user.username || "",
        ssoEmail: user.ssoEmail || "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    }
  }, [user, form]);

  // Update SSO form when config loads (only once)
  useEffect(() => {
    if (ssoConfig && !ssoFormInitialized.current) {
      ssoFormInitialized.current = true;
      ssoForm.reset({
        enabled: ssoConfig.enabled === 1,
        clientId: ssoConfig.clientId || "",
        clientSecret: ssoConfig.clientSecret || "",
        authUrl: ssoConfig.authUrl || "",
        tokenUrl: ssoConfig.tokenUrl || "",
        userInfoUrl: ssoConfig.userInfoUrl || "",
        redirectUrl: ssoConfig.redirectUrl || "",
        logoutUrl: ssoConfig.logoutUrl || "",
        userIdentifier: ssoConfig.userIdentifier || "email",
        scopes: ssoConfig.scopes || "openid",
        authStyle: ssoConfig.authStyle || "auto",
      });
    }
  }, [ssoConfig, ssoForm]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateUserForm) => {
      const updateData: any = {
        name: data.name,
        nickname: data.nickname,
        username: data.username,
        ssoEmail: data.ssoEmail || null,
      };

      // Only include password fields if user wants to change password
      if (data.newPassword && data.currentPassword) {
        updateData.currentPassword = data.currentPassword;
        updateData.newPassword = data.newPassword;
      }

      return apiRequest("PATCH", "/api/user", updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Success",
        description: "Your information has been updated",
      });
      // Clear password fields
      form.setValue("currentPassword", "");
      form.setValue("newPassword", "");
      form.setValue("confirmPassword", "");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update information",
        variant: "destructive",
      });
    },
  });

  const ssoMutation = useMutation({
    mutationFn: async (data: SsoConfigForm) => {
      return apiRequest("POST", "/api/sso-config", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sso-config"] });
      toast({
        title: "Success",
        description: "SSO configuration has been saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save SSO configuration",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateUserForm) => {
    updateMutation.mutate(data);
  };

  const onSsoSubmit = (data: SsoConfigForm) => {
    ssoMutation.mutate(data);
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading user information...</p>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8 pl-12">
      <Card>
        <CardHeader>
          <CardTitle>User Options</CardTitle>
          <CardDescription>Update your personal information and password</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Personal Information</h3>
                
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="nickname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nickname</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-nickname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ssoEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SSO Email</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Optional - for SSO login" data-testid="input-sso-email" />
                      </FormControl>
                      <FormDescription>
                        When using SSO, this email will be matched with your identity provider
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-sm font-medium">Change Password (Optional)</h3>
                <p className="text-sm text-muted-foreground">Leave blank to keep current password</p>

                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} data-testid="input-current-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} data-testid="input-new-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} data-testid="input-confirm-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button 
                type="submit" 
                disabled={updateMutation.isPending}
                data-testid="button-save-changes"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* SSO Configuration Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>SSO Configuration</CardTitle>
          <CardDescription>Configure Single Sign-On (OAuth2/OIDC) authentication</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...ssoForm}>
            <form onSubmit={ssoForm.handleSubmit(onSsoSubmit)} className="space-y-6">
              <FormField
                control={ssoForm.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Enable SSO</FormLabel>
                      <FormDescription>
                        Allow login via Single Sign-On provider
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-sso-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <h3 className="text-sm font-medium">OAuth2 Provider Settings</h3>
                
                <FormField
                  control={ssoForm.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client ID</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-sso-client-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="clientSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client Secret</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showClientSecret ? "text" : "password"}
                            placeholder={ssoConfig?.clientSecret === '********' ? '********' : ''}
                            data-testid="input-sso-client-secret"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full"
                            onClick={() => setShowClientSecret(!showClientSecret)}
                            data-testid="button-toggle-secret"
                          >
                            {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="authUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auth URL</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://provider.com/oauth/authorize" data-testid="input-sso-auth-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="tokenUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Access Token URL</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://provider.com/oauth/token" data-testid="input-sso-token-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="userInfoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Resource URL (User Info)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://provider.com/oauth/userinfo" data-testid="input-sso-userinfo-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="redirectUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Redirect URL</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://your-app.com/api/sso/callback" data-testid="input-sso-redirect-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="logoutUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Logout URL (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://provider.com/oauth/logout" data-testid="input-sso-logout-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="userIdentifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User Identifier</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="email" data-testid="input-sso-user-identifier" />
                      </FormControl>
                      <FormDescription>
                        Field name in user info response (default: email)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="scopes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Scopes</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="openid profile email" data-testid="input-sso-scopes" />
                      </FormControl>
                      <FormDescription>
                        Space-separated OAuth scopes (default: openid)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={ssoForm.control}
                  name="authStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auth Style</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-sso-auth-style">
                            <SelectValue placeholder="Select auth style" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="in_params">In Params</SelectItem>
                          <SelectItem value="in_header">In Header</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        How to send client credentials (default: auto)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                disabled={ssoMutation.isPending}
                data-testid="button-save-sso"
              >
                {ssoMutation.isPending ? "Saving..." : "Save SSO Configuration"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
