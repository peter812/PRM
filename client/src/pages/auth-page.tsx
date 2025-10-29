import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Users, Network, Search, Shield } from "lucide-react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";

export default function AuthPage() {
  const { user, loginMutation } = useAuth();

  // Check if setup is needed (0 users in database)
  const { data: setupStatus } = useQuery<{ isSetupNeeded: boolean }>({
    queryKey: ["/api/setup/status"],
    refetchInterval: false,
    staleTime: 0, // Always fetch fresh
  });

  // Check if SSO is enabled
  const { data: ssoConfig } = useQuery<{ enabled: number }>({
    queryKey: ["/api/sso-config"],
  });

  const loginForm = useForm<InsertUser>({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  // Redirect to welcome page if setup is needed
  if (setupStatus?.isSetupNeeded) {
    return <Redirect to="/welcome" />;
  }

  if (user) {
    return <Redirect to="/" />;
  }

  const handleLogin = (data: InsertUser) => {
    loginMutation.mutate(data);
  };

  const handleSsoLogin = () => {
    // Redirect to SSO initiation endpoint
    window.location.href = "/api/sso/login";
  };

  const isSsoEnabled = ssoConfig?.enabled === 1;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">People Manager</h1>
            <p className="text-muted-foreground">
              Sign in to manage your professional network
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Enter your credentials to access your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter your username"
                            data-testid="input-login-username"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="Enter your password"
                            data-testid="input-login-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loginMutation.isPending}
                    data-testid="button-login"
                  >
                    {loginMutation.isPending ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              </Form>

              {isSsoEnabled && (
                <>
                  <div className="relative my-6">
                    <Separator />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                      or
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleSsoLogin}
                    data-testid="button-sso-login"
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Sign in with SSO
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-primary text-primary-foreground p-12">
        <div className="max-w-md">
          <h2 className="text-4xl font-bold mb-6">Manage Your Professional Network</h2>
          <p className="text-lg mb-8 opacity-90">
            A powerful CRM to track contacts, interactions, and relationships all in one place.
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Users className="h-6 w-6 mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-semibold mb-1">Contact Management</h3>
                <p className="opacity-80">
                  Store detailed profiles with notes and interaction history
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Network className="h-6 w-6 mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-semibold mb-1">Relationship Mapping</h3>
                <p className="opacity-80">
                  Visualize connections between people with interactive graphs
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Search className="h-6 w-6 mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-semibold mb-1">Advanced Search</h3>
                <p className="opacity-80">
                  Find contacts quickly with powerful search and filtering
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
