import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type GraphMode = 'default' | 'blob' | 'single-highlight' | 'multi-highlight';

const STORAGE_KEY = 'socialGraphDefaults';

function loadDefaults(): { defaultMode: GraphMode; defaultSingleAccountId: string | null } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        defaultMode: parsed.defaultMode ?? 'single-highlight',
        defaultSingleAccountId: parsed.defaultSingleAccountId ?? null,
      };
    }
  } catch {}
  return { defaultMode: 'single-highlight', defaultSingleAccountId: null };
}

export default function SocialGraphSettingsPage() {
  const { toast } = useToast();
  const initial = loadDefaults();

  const [defaultMode, setDefaultMode] = useState<GraphMode>(initial.defaultMode);
  const [defaultSingleAccountId, setDefaultSingleAccountId] = useState<string | null>(initial.defaultSingleAccountId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: socialAccounts = [] } = useQuery<{ id: string; username: string; currentProfile?: { nickname?: string | null } | null }[]>({
    queryKey: ["/api/social-accounts"],
  });

  const selectedAccount = defaultSingleAccountId
    ? socialAccounts.find(a => a.id === defaultSingleAccountId)
    : null;

  const filteredAccounts = searchQuery.length >= 3
    ? socialAccounts.filter(a => {
        const q = searchQuery.toLowerCase();
        const nick = a.currentProfile?.nickname?.toLowerCase() ?? '';
        return a.username.toLowerCase().includes(q) || nick.includes(q);
      })
    : [];

  function handleSave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        defaultMode,
        defaultSingleAccountId,
      }));
      toast({ title: "Saved", description: "Social graph defaults updated." });
    } catch {
      toast({ title: "Error", description: "Could not save settings.", variant: "destructive" });
    }
  }

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-social-graph-settings-title">Social Graph Settings</h1>
        <p className="text-muted-foreground">
          Configure the default behaviour of the social account graph.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Graph Defaults</CardTitle>
          <CardDescription>These settings are applied when you first open the social graph.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="default-mode">Default Mode</Label>
            <Select
              value={defaultMode}
              onValueChange={(v) => setDefaultMode(v as GraphMode)}
            >
              <SelectTrigger id="default-mode" data-testid="select-default-graph-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" data-testid="option-mode-default">Default</SelectItem>
                <SelectItem value="blob" data-testid="option-mode-blob">Blob</SelectItem>
                <SelectItem value="single-highlight" data-testid="option-mode-single">Single</SelectItem>
                <SelectItem value="multi-highlight" data-testid="option-mode-multi">Multi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {defaultMode === 'single-highlight' && (
            <div className="space-y-2">
              <Label>Default Account (Single mode)</Label>
              <p className="text-sm text-muted-foreground">
                This account will be pre-selected when the graph opens in Single mode.
              </p>
              <div className="relative">
                {defaultSingleAccountId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-0 top-0 h-full z-10 hover:bg-transparent"
                    onClick={() => setDefaultSingleAccountId(null)}
                    data-testid="button-clear-default-account"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <Popover open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setSearchQuery(''); }}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      style={{ paddingLeft: defaultSingleAccountId ? '2.5rem' : undefined }}
                      data-testid="button-default-account-search"
                    >
                      {selectedAccount
                        ? (selectedAccount.currentProfile?.nickname || selectedAccount.username)
                        : 'Select account...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Type 3+ characters to search..."
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                        data-testid="input-default-account-search"
                      />
                      <CommandList>
                        {searchQuery.length > 0 && searchQuery.length < 3 && (
                          <div className="p-3 text-sm text-muted-foreground text-center">
                            Type {3 - searchQuery.length} more character{3 - searchQuery.length > 1 ? 's' : ''} to search...
                          </div>
                        )}
                        {searchQuery.length === 0 && (
                          <div className="p-3 text-sm text-muted-foreground text-center">
                            Start typing to search accounts...
                          </div>
                        )}
                        {filteredAccounts.length === 0 && searchQuery.length >= 3 && (
                          <div className="p-3 text-sm text-muted-foreground text-center">No accounts found.</div>
                        )}
                        {filteredAccounts.map(account => (
                          <CommandItem
                            key={account.id}
                            onSelect={() => {
                              setDefaultSingleAccountId(account.id);
                              setSearchOpen(false);
                              setSearchQuery('');
                            }}
                            data-testid={`option-default-account-${account.id}`}
                          >
                            <span className="font-medium">{account.currentProfile?.nickname || account.username}</span>
                            {account.currentProfile?.nickname && (
                              <span className="ml-2 text-muted-foreground text-sm">@{account.username}</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          <Button onClick={handleSave} data-testid="button-save-graph-defaults">
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
