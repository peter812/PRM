import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Users,
  Network,
  Instagram,
  Brain,
  CalendarDays,
  Trophy,
  FileDown,
  Shield,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { useState } from "react";

const setupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  nickname: z.string().min(1, "Nickname is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type SetupFormData = z.infer<typeof setupSchema>;

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

export default function WelcomePage() {
  const { toast } = useToast();
  const [setupComplete, setSetupComplete] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["/api/user"],
    retry: false,
  });

  const form = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      name: "",
      nickname: "",
      username: "",
      password: "",
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: SetupFormData) => {
      const response = await apiRequest("POST", "/api/setup/initialize", data);
      return await response.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/setup/status"], { isSetupNeeded: false });
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Setup Complete",
        description: "Your account has been created successfully!",
      });
      setSetupComplete(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  if (currentUser) {
    return <Redirect to="/me" />;
  }

  if (setupComplete) {
    return <Redirect to="/me" />;
  }

  const handleSubmit = (data: SetupFormData) => {
    setupMutation.mutate(data);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — setup form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">People Manager</h1>
            <p className="text-muted-foreground">
              Welcome! Create your account to get started
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Create Your Account</CardTitle>
              <CardDescription>
                You're the first user — this account becomes your "ME" profile at the center of your network.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter your full name"
                            data-testid="input-setup-name"
                          />
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
                          <Input
                            {...field}
                            placeholder="How you prefer to be called"
                            data-testid="input-setup-nickname"
                          />
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
                          <Input
                            {...field}
                            placeholder="Choose a login username"
                            data-testid="input-setup-username"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="At least 6 characters"
                            data-testid="input-setup-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={setupMutation.isPending}
                    data-testid="button-setup-submit"
                  >
                    {setupMutation.isPending ? "Creating Account..." : "Create Account & Get Started"}
                  </Button>
                </form>
              </Form>
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
