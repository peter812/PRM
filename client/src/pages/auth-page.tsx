import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Users,
  Network,
  Shield,
  Brain,
  Instagram,
  FileDown,
  CalendarDays,
  Trophy,
} from "lucide-react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";

const FEATURES = [
  {
    icon: Users,
    title: "People & Groups",
    description: "Rich profiles with notes, interaction history, tags, and group membership",
  },
  {
    icon: Network,
    title: "Relationship Graphs",
    description: "WebGL-powered interactive graphs with blob mode, orphan filtering, and anonymization",
  },
  {
    icon: Instagram,
    title: "Social Account Tracking",
    description: "Versioned profile history and follower/following change logs for every linked account",
  },
  {
    icon: Brain,
    title: "AI Intelligence",
    description: "AI chat with live tool-call reasoning, image recognition, and smart description generation",
  },
  {
    icon: CalendarDays,
    title: "Daily Notes & Flow",
    description: "Chronological per-person timeline mixing notes, interactions, and communications",
  },
  {
    icon: Trophy,
    title: "ELO Ranking & Matching",
    description: "Head-to-head ranking and social account matching with similarity scoring",
  },
  {
    icon: FileDown,
    title: "XML Import & Export",
    description: "Full data backup and migration preserving UUIDs, with background task processing",
  },
  {
    icon: Shield,
    title: "API & SSO Access",
    description: "External REST API with key-based auth and optional single sign-on",
  },
];

export default function AuthPage() {
  const { user, loginMutation } = useAuth();

  const { data: setupStatus } = useQuery<{ isSetupNeeded: boolean }>({
    queryKey: ["/api/setup/status"],
    refetchInterval: false,
    staleTime: 0,
  });

  const { data: ssoStatus } = useQuery<{ enabled: number }>({
    queryKey: ["/api/sso-config/status"],
  });

  const loginForm = useForm<InsertUser>({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

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
    window.location.href = "/api/sso/login";
  };

  const isSsoEnabled = ssoStatus?.enabled === 1;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">People Manager</h1>
            <p className="text-muted-foreground">
              Your personal CRM for contacts, relationships, and social intelligence
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Sign in to continue managing your network
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

      {/* Right — feature showcase */}
      <div className="hidden lg:flex items-center justify-center bg-primary text-primary-foreground p-12 overflow-y-auto">
        <div className="max-w-md w-full">
          <h2 className="text-3xl font-bold mb-2">Everything you need to manage your network</h2>
          <p className="text-base mb-8 opacity-80">
            From social tracking to AI-powered insights — all in one place.
          </p>
          <div className="grid gap-5">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0 rounded-md bg-primary-foreground/10 p-1.5">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-0.5">{title}</h3>
                  <p className="text-sm opacity-75">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
