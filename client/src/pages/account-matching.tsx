import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserX, Link2, SkipForward, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Person, SocialAccount } from "@shared/schema";

type CandidateAccount = SocialAccount & {
  typeName: string | null;
  typeColor: string | null;
  matchScore: number;
};

type MatchingResponse = {
  person: Person | null;
  candidates: CandidateAccount[];
};

export default function AccountMatching() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<MatchingResponse>({
    queryKey: ["/api/account-matching/next"],
  });

  const connectMutation = useMutation({
    mutationFn: async ({
      personId,
      socialAccountIds,
    }: {
      personId: string;
      socialAccountIds: string[];
    }) => {
      return await apiRequest("POST", "/api/account-matching/connect", {
        personId,
        socialAccountIds,
      });
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Accounts linked successfully" });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/account-matching/next"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to connect accounts", variant: "destructive" });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (personId: string) => {
      return await apiRequest("POST", "/api/account-matching/ignore", { personId });
    },
    onSuccess: () => {
      toast({ title: "Ignored", description: "Person marked as no social media" });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/account-matching/next"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update person", variant: "destructive" });
    },
  });

  const handleSkip = () => {
    setSelectedIds(new Set());
    refetch();
  };

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConnect = () => {
    if (!data?.person || selectedIds.size === 0) return;
    connectMutation.mutate({
      personId: data.person.id,
      socialAccountIds: Array.from(selectedIds),
    });
  };

  const handleIgnore = () => {
    if (!data?.person) return;
    ignoreMutation.mutate(data.person.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.person) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <Check className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold" data-testid="text-all-matched">All caught up</h2>
        <p className="text-muted-foreground text-center max-w-md" data-testid="text-no-unmatched">
          Every person either has linked social accounts or has been marked as having no social media.
        </p>
      </div>
    );
  }

  const person = data.person;
  const candidates = data.candidates;
  const isPending = connectMutation.isPending || ignoreMutation.isPending;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="text-center space-y-1">
          <h1
            className="text-2xl font-bold"
            data-testid="text-person-name"
          >
            {person.firstName} {person.lastName}
          </h1>
          {(person.company || person.title) && (
            <p className="text-muted-foreground" data-testid="text-person-details">
              {person.title}
              {person.title && person.company ? " at " : ""}
              {person.company}
            </p>
          )}
        </div>

        {candidates.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground" data-testid="text-no-candidates">
              No unlinked social accounts found to match.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidates.map((account) => {
              const isSelected = selectedIds.has(account.id);
              return (
                <Card
                  key={account.id}
                  className={`p-4 cursor-pointer transition-colors ${
                    isSelected
                      ? "border-green-500 bg-green-500/10 dark:bg-green-500/15"
                      : "hover-elevate"
                  }`}
                  onClick={() => toggleAccount(account.id)}
                  data-testid={`card-account-${account.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium truncate" data-testid={`text-username-${account.id}`}>
                        {account.username}
                      </p>
                      {account.nickname && (
                        <p className="text-sm text-muted-foreground truncate" data-testid={`text-nickname-${account.id}`}>
                          {account.nickname}
                        </p>
                      )}
                      {account.typeName && (
                        <Badge
                          variant="secondary"
                          style={account.typeColor ? { backgroundColor: account.typeColor, color: "#fff" } : undefined}
                          data-testid={`badge-type-${account.id}`}
                        >
                          {account.typeName}
                        </Badge>
                      )}
                      {account.matchScore > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Match confidence: {Math.min(account.matchScore, 100)}%
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <div className="shrink-0 text-green-500">
                        <Check className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button
            onClick={handleConnect}
            disabled={selectedIds.size === 0 || isPending}
            data-testid="button-connect-accounts"
            className="gap-2"
          >
            <Link2 className="h-4 w-4" />
            {connectMutation.isPending ? "Connecting..." : `Connect Account${selectedIds.size !== 1 ? "s" : ""}`}
          </Button>
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isPending}
            data-testid="button-skip"
            className="gap-2"
          >
            <SkipForward className="h-4 w-4" />
            Skip
          </Button>
          <Button
            variant="outline"
            onClick={handleIgnore}
            disabled={isPending}
            data-testid="button-ignore"
            className="gap-2"
          >
            <UserX className="h-4 w-4" />
            {ignoreMutation.isPending ? "Ignoring..." : "Ignore"}
          </Button>
        </div>
      </div>
    </div>
  );
}
