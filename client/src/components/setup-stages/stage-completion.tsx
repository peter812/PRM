import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  CheckCircle2,
  Users,
  Network,
  Brain,
  User,
  ArrowRight,
  Sparkles,
  Layers,
  HardDrive,
} from "lucide-react";
import type { RelationshipType, InteractionType } from "@shared/schema";

export function StageCompletion({ onFinish }: { onFinish?: () => void }) {
  const { data: peopleData } = useQuery<{ total: number }>({
    queryKey: ["/api/people/paginated", { page: 1, limit: 1 }],
  });

  const { data: relationshipTypes = [] } = useQuery<RelationshipType[]>({
    queryKey: ["/api/relationship-types"],
  });

  const { data: interactionTypes = [] } = useQuery<InteractionType[]>({
    queryKey: ["/api/interaction-types"],
  });

  const { data: health } = useQuery<Record<string, { ok: boolean; status: string }>>({
    queryKey: ["/api/setup/services/health"],
  });

  const onlineServicesCount = Object.values(health || {}).filter((s) => s.ok).length;

  return (
    <div className="space-y-6">
      {/* Hero completion banner */}
      <div className="text-center py-6 px-4 rounded-xl bg-gradient-to-b from-primary/10 via-primary/5 to-transparent border">
        <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-600 mb-3 shadow-sm">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold">You're All Set!</h2>
        <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
          Your PRM instance is configured and ready. You can reopen this Unified Setup Assistant at any time from Settings.
        </p>
      </div>

      {/* Summary Scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center border">
          <div className="text-2xl font-bold">{onlineServicesCount}/5</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <HardDrive className="h-3 w-3" /> Services Online
          </p>
        </Card>
        <Card className="p-3 text-center border">
          <div className="text-2xl font-bold">{relationshipTypes.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <Layers className="h-3 w-3" /> Rel Types
          </p>
        </Card>
        <Card className="p-3 text-center border">
          <div className="text-2xl font-bold">{interactionTypes.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <Sparkles className="h-3 w-3" /> Int Types
          </p>
        </Card>
        <Card className="p-3 text-center border">
          <div className="text-2xl font-bold">{peopleData?.total || 0}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <Users className="h-3 w-3" /> Contacts
          </p>
        </Card>
      </div>

      {/* Quick Launch Cards */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Suggested Next Steps
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link href="/me">
            <Card
              className="p-3.5 hover-elevate transition-all cursor-pointer group border flex items-center justify-between"
              onClick={onFinish}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h5 className="font-semibold text-xs group-hover:text-primary transition-colors">
                    View "ME" Profile
                  </h5>
                  <p className="text-[11px] text-muted-foreground">
                    Customize your central profile card and avatar
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </Card>
          </Link>

          <Link href="/people">
            <Card
              className="p-3.5 hover-elevate transition-all cursor-pointer group border flex items-center justify-between"
              onClick={onFinish}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-600">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h5 className="font-semibold text-xs group-hover:text-primary transition-colors">
                    People Directory
                  </h5>
                  <p className="text-[11px] text-muted-foreground">
                    Browse people, manage tags, and log notes
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </Card>
          </Link>

          <Link href="/social-graph-3d">
            <Card
              className="p-3.5 hover-elevate transition-all cursor-pointer group border flex items-center justify-between"
              onClick={onFinish}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600">
                  <Network className="h-4 w-4" />
                </div>
                <div>
                  <h5 className="font-semibold text-xs group-hover:text-primary transition-colors">
                    3D Social Graph
                  </h5>
                  <p className="text-[11px] text-muted-foreground">
                    Explore clusters and connection physics in WebGL
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </Card>
          </Link>

          <Link href="/ai-chat-demo">
            <Card
              className="p-3.5 hover-elevate transition-all cursor-pointer group border flex items-center justify-between"
              onClick={onFinish}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600">
                  <Brain className="h-4 w-4" />
                </div>
                <div>
                  <h5 className="font-semibold text-xs group-hover:text-primary transition-colors">
                    AI Intelligence Chat
                  </h5>
                  <p className="text-[11px] text-muted-foreground">
                    Query your personal network with AI reasoning
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
