import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isValidHexColor } from "@/lib/utils";
import { asLevel } from "@/components/interest-level-badge";
import { OsintChipDialog } from "@/components/osint-results";
import { INTEREST_LEVEL_COLOR, INTEREST_LEVEL_LABEL } from "@shared/interest-level";
import { OSINT_TOOLS, type OsintResults, type OsintTargetType } from "@shared/osint-tools";
import type { OsintRuns, PersonWithRelations, SocialAccountType } from "@shared/schema";

/** Overview card: each linked account with its tracking level and OSINT chip. */
export function PersonSocialAccountsCard({ person }: { person: PersonWithRelations }) {
  const accounts = person.socialAccounts ?? [];
  const { data: types = [] } = useQuery<SocialAccountType[]>({ queryKey: ["/api/social-account-types"] });
  const { data: results = {} } = useQuery<Record<string, OsintResults>>({
    queryKey: ["/api/osint/results", { socialAccountIds: accounts.map((a) => a.id).join(",") }],
    enabled: accounts.length > 0,
  });

  return (
    <Card className="p-4 space-y-3 shadow-none" data-testid="card-person-social-accounts">
      <h3 className="font-semibold text-sm">Social Accounts</h3>
      {accounts.length ? (
        <div className="space-y-2 text-xs">
          {accounts.map((a) => {
            const type = types.find((t) => t.id === a.typeId);
            const color = type && isValidHexColor(type.color) ? type.color : undefined;
            const level = asLevel(a.interestLevel);
            return (
              <div key={a.id} className="flex items-center gap-2 border-b pb-2 last:border-0 last:pb-0">
                <Badge variant="outline" className="text-[10px] shrink-0" style={color ? { color, borderColor: `${color}50` } : undefined}>
                  {type?.name ?? "Unknown"}
                </Badge>
                <Link href={`/social-accounts/${a.id}`} className="font-medium truncate hover:underline">@{a.username}</Link>
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${INTEREST_LEVEL_COLOR[level]}`} title={`Tracking: ${INTEREST_LEVEL_LABEL[level]}`} />
                <span className="ml-auto">
                  <OsintChipDialog title={`@${a.username}`} results={results[a.id]} request={{ socialAccountId: a.id }} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No social accounts linked.</p>
      )}
    </Card>
  );
}

const SECTIONS: { key: keyof OsintRuns; label: string; type: OsintTargetType }[] = [
  { key: "emails", label: "Emails", type: "email" },
  { key: "phones", label: "Phones", type: "phone" },
  { key: "usernames", label: "Other usernames", type: "username" },
];

/** Collapsed by default; opening it is what loads the person's OSINT results. */
export function PersonOsintRunsCard({ person }: { person: PersonWithRelations }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const runs = person.osintRuns ?? { emails: [], phones: [], usernames: [] };
  const { data: results = {} } = useQuery<Record<string, OsintResults>>({
    queryKey: ["/api/osint/results", { personId: person.id }],
    enabled: open,
    refetchInterval: isPolling ? 3000 : false,
  });
  const save = useMutation({
    mutationFn: (osintRuns: OsintRuns) => apiRequest("PATCH", `/api/people/${person.id}`, { osintRuns }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/people", person.id] }),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  // Contact details not yet in the list, offered as one-click adds.
  const contact: Partial<Record<keyof OsintRuns, string[]>> = {
    emails: [person.email, ...(person.additionalEmails ?? [])].filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()),
    phones: [person.phone, ...(person.additionalPhones ?? [])].filter((p): p is string => !!p).map((p) => p.trim()),
  };
  const setList = (key: keyof OsintRuns, list: string[]) => save.mutate({ ...runs, [key]: list });
  const handleAdd = (key: keyof OsintRuns, target: string, type: OsintTargetType) => {
    const clean = type === "email" ? target.trim().toLowerCase() : target.trim();
    if (!clean || runs[key].includes(clean)) return;
    setList(key, [...runs[key], clean]);
  };

  return (
    <Card className="p-4 space-y-3 shadow-none" data-testid="card-person-osint-runs">
      <button type="button" className="w-full flex items-center justify-between font-semibold text-sm" onClick={() => setOpen(!open)}>
        <span>OSINT Runs</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 text-xs">
          {SECTIONS.map(({ key, label, type }) => {
            const list = runs[key];
            const scannable = OSINT_TOOLS.some((t) => t.supportedTargetTypes.includes(type));
            const suggestions = (contact[key] ?? []).filter((c) => !list.includes(c));
            return (
              <div key={key} className="space-y-2">
                <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">{label}</span>
                {list.map((target) => (
                  <div key={target} className="flex items-center gap-2" title={scannable ? undefined : `No OSINT tool scans ${label.toLowerCase()} yet`}>
                    <span className="min-w-0 truncate font-medium">{target}</span>
                    <span className="ml-auto shrink-0">
                      <OsintChipDialog
                        title={target}
                        results={results[target]}
                        request={{ personId: person.id, target, targetType: type }}
                        disabled={!scannable}
                      />
                    </span>
                    <button type="button" onClick={() => setList(key, list.filter((t) => t !== target))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${target}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {suggestions.map((s) => (
                  <Badge key={s} variant="outline" className="cursor-pointer text-[10px] mr-1" onClick={() => handleAdd(key, s, type)}>
                    <Plus className="h-3 w-3 mr-0.5" />
                    {s}
                  </Badge>
                ))}
                <AddTarget onAdd={(t) => handleAdd(key, t, type)} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AddTarget({ onAdd }: { onAdd: (target: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      setValue("");
      onAdd(trimmed);
    }
  };
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
      onBlur={submit}
      placeholder="+ Add"
      className="h-7 text-xs"
    />
  );
}
