import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  EXTRAS_STEPS,
  MERGE_MULTIPLIER_STEPS,
  SOCIAL_GRAPH_DEFAULTS,
  type GraphMode,
  type ColorScheme,
  type SingleNodeColorScheme,
  type SocialGraphDefaults,
  loadSocialGraphDefaults,
  saveSocialGraphDefaults,
} from "@/lib/social-graph-defaults";

type SocialAccountOption = {
  id: string;
  username: string;
  currentProfile?: { nickname?: string | null } | null;
};

interface AccountPickerProps {
  accounts: SocialAccountOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  testId: string;
}

function AccountPicker({ accounts, value, onChange, placeholder = 'Select account...', testId }: AccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = value ? accounts.find(a => a.id === value) ?? null : null;
  const filtered = query.length >= 3
    ? accounts.filter(a => {
        const q = query.toLowerCase();
        const nick = a.currentProfile?.nickname?.toLowerCase() ?? '';
        return a.username.toLowerCase().includes(q) || nick.includes(q);
      })
    : [];

  return (
    <div className="relative">
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 top-0 h-full z-10 hover:bg-transparent"
          onClick={() => onChange(null)}
          data-testid={`button-clear-${testId}`}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start text-left font-normal"
            style={{ paddingLeft: value ? '2.5rem' : undefined }}
            data-testid={`button-${testId}-search`}
          >
            {selected
              ? (selected.currentProfile?.nickname || selected.username)
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type 3+ characters to search..."
              value={query}
              onValueChange={setQuery}
              data-testid={`input-${testId}-search`}
            />
            <CommandList>
              {query.length > 0 && query.length < 3 && (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  Type {3 - query.length} more character{3 - query.length > 1 ? 's' : ''} to search...
                </div>
              )}
              {query.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  Start typing to search accounts...
                </div>
              )}
              {filtered.length === 0 && query.length >= 3 && (
                <div className="p-3 text-sm text-muted-foreground text-center">No accounts found.</div>
              )}
              {filtered.map(account => (
                <CommandItem
                  key={account.id}
                  onSelect={() => {
                    onChange(account.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  data-testid={`option-${testId}-${account.id}`}
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
  );
}

interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function ColorField({ id, label, value, onChange }: ColorFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-16 cursor-pointer p-1"
          data-testid={`color-${id}`}
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 flex-1 font-mono text-sm"
          data-testid={`color-text-${id}`}
        />
      </div>
    </div>
  );
}

export default function SocialGraphSettingsPage() {
  const { toast } = useToast();

  const [settings, setSettings] = useState<SocialGraphDefaults>(() => loadSocialGraphDefaults());

  const update = <K extends keyof SocialGraphDefaults>(key: K, value: SocialGraphDefaults[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const { data: socialAccounts = [] } = useQuery<SocialAccountOption[]>({
    queryKey: ["/api/social-accounts"],
  });

  function handleSave() {
    try {
      saveSocialGraphDefaults(settings);
      toast({ title: "Saved", description: "Social graph defaults updated." });
    } catch {
      toast({ title: "Error", description: "Could not save settings.", variant: "destructive" });
    }
  }

  function handleResetDefaults() {
    setSettings({ ...SOCIAL_GRAPH_DEFAULTS });
    toast({ title: "Reset", description: "Settings reset to defaults. Click Save to persist." });
  }

  const mergeIndex = Math.max(0, MERGE_MULTIPLIER_STEPS.indexOf(settings.blobMergeMultiplier));
  const extrasIndex = Math.max(0, EXTRAS_STEPS.indexOf(settings.maxExtras));

  return (
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold" data-testid="text-social-graph-settings-title">Social Graph Settings</h1>
        <p className="text-muted-foreground">
          Configure the default behaviour of the social account graph. These options are applied
          when the graph is opened with no URL parameters &mdash; URL params (e.g. <code>?view=...</code>,
          <code> ?selected=...</code>) override these defaults.
        </p>
      </div>

      {/* Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
          <CardDescription>The view the graph opens in by default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="default-mode">Default Mode</Label>
            <Select value={settings.defaultMode} onValueChange={(v) => update('defaultMode', v as GraphMode)}>
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
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Control which accounts appear in the graph.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="hide-orphans">Hide orphans</Label>
            <Switch
              id="hide-orphans"
              checked={settings.hideOrphans}
              onCheckedChange={(v) => update('hideOrphans', v)}
              data-testid="switch-hide-orphans"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Minimum connections</Label>
              <span className="text-sm font-medium" data-testid="text-min-connections-value">{settings.minConnections}</span>
            </div>
            <Slider
              value={[settings.minConnections]}
              min={0}
              max={20}
              step={1}
              onValueChange={(v) => update('minConnections', v[0])}
              data-testid="slider-min-connections"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="limit-extras">Limit extras</Label>
            <Switch
              id="limit-extras"
              checked={settings.limitExtras}
              onCheckedChange={(v) => update('limitExtras', v)}
              data-testid="switch-limit-extras"
            />
          </div>

          {settings.limitExtras && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Max extras</Label>
                <span className="text-sm font-medium" data-testid="text-max-extras-value">{settings.maxExtras}</span>
              </div>
              <Slider
                value={[extrasIndex]}
                min={0}
                max={EXTRAS_STEPS.length - 1}
                step={1}
                onValueChange={(v) => update('maxExtras', EXTRAS_STEPS[v[0]])}
                data-testid="slider-max-extras"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                {EXTRAS_STEPS.map(step => (
                  <span key={step}>{step}</span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Default mode colors */}
      <Card>
        <CardHeader>
          <CardTitle>Default Mode Colors</CardTitle>
          <CardDescription>Color scheme used when the graph is in Default mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="color-scheme">Color scheme</Label>
            <Select value={settings.colorScheme} onValueChange={(v) => update('colorScheme', v as ColorScheme)}>
              <SelectTrigger id="color-scheme" data-testid="select-color-scheme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="type">By type</SelectItem>
                <SelectItem value="distance">By distance</SelectItem>
                <SelectItem value="connections">By connection count</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.colorScheme === 'distance' && (
            <div className="space-y-2">
              <Label>Reference account (Distance scheme)</Label>
              <p className="text-sm text-muted-foreground">Distances are measured from this account.</p>
              <AccountPicker
                accounts={socialAccounts}
                value={settings.colorSchemeAccountId}
                onChange={(id) => update('colorSchemeAccountId', id)}
                testId="distance-account"
              />
            </div>
          )}

          {settings.colorScheme === 'distance' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorField id="distance-self" label="Self" value={settings.distanceColorSelf} onChange={(v) => update('distanceColorSelf', v)} />
              <ColorField id="distance-direct" label="Direct" value={settings.distanceColorDirect} onChange={(v) => update('distanceColorDirect', v)} />
              <ColorField id="distance-2nd" label="2nd degree" value={settings.distanceColor2nd} onChange={(v) => update('distanceColor2nd', v)} />
              <ColorField id="distance-other" label="Other" value={settings.distanceColorOther} onChange={(v) => update('distanceColorOther', v)} />
            </div>
          )}

          {settings.colorScheme === 'connections' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorField id="connections-min" label="Fewest connections" value={settings.connectionsColorMin} onChange={(v) => update('connectionsColorMin', v)} />
              <ColorField id="connections-max" label="Most connections" value={settings.connectionsColorMax} onChange={(v) => update('connectionsColorMax', v)} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ColorField id="link-mutual" label="Mutual link" value={settings.linkMutualColor} onChange={(v) => update('linkMutualColor', v)} />
            <ColorField id="link-default" label="Default link" value={settings.linkDefaultColor} onChange={(v) => update('linkDefaultColor', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Single highlight */}
      <Card>
        <CardHeader>
          <CardTitle>Single Highlight Mode</CardTitle>
          <CardDescription>Settings used when the graph opens in Single highlight mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Default account</Label>
            <p className="text-sm text-muted-foreground">
              Pre-selected when the graph opens in Single mode.
            </p>
            <AccountPicker
              accounts={socialAccounts}
              value={settings.defaultSingleAccountId}
              onChange={(id) => update('defaultSingleAccountId', id)}
              testId="default-account"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="single-node-color">Node color scheme</Label>
            <Select
              value={settings.singleNodeColorScheme}
              onValueChange={(v) => update('singleNodeColorScheme', v as SingleNodeColorScheme)}
            >
              <SelectTrigger id="single-node-color" data-testid="select-single-node-color">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="follow-status">Follow status</SelectItem>
                <SelectItem value="type">Account type</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="single-show-friend-links">Show friend links</Label>
            <Switch
              id="single-show-friend-links"
              checked={settings.singleShowFriendLinks}
              onCheckedChange={(v) => update('singleShowFriendLinks', v)}
              data-testid="switch-single-show-friend-links"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="single-remove-extras">Remove extras</Label>
            <Switch
              id="single-remove-extras"
              checked={settings.singleRemoveExtras}
              onCheckedChange={(v) => update('singleRemoveExtras', v)}
              data-testid="switch-single-remove-extras"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorField id="single-mutual" label="Mutual" value={settings.singleLinkMutualColor} onChange={(v) => update('singleLinkMutualColor', v)} />
            <ColorField id="single-follows-you" label="Follows you" value={settings.singleLinkFollowsYouColor} onChange={(v) => update('singleLinkFollowsYouColor', v)} />
            <ColorField id="single-you-follow" label="You follow" value={settings.singleLinkYouFollowColor} onChange={(v) => update('singleLinkYouFollowColor', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Multi highlight */}
      <Card>
        <CardHeader>
          <CardTitle>Multi Highlight Mode</CardTitle>
          <CardDescription>Colors used in Multi highlight mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorField id="multi-highlight" label="Highlighted" value={settings.multiHighlightColor} onChange={(v) => update('multiHighlightColor', v)} />
            <ColorField id="multi-follows-all" label="Follows all" value={settings.multiFollowsAllColor} onChange={(v) => update('multiFollowsAllColor', v)} />
            <ColorField id="multi-follows-one" label="Follows one" value={settings.multiFollowsOneColor} onChange={(v) => update('multiFollowsOneColor', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Blob */}
      <Card>
        <CardHeader>
          <CardTitle>Blob Mode</CardTitle>
          <CardDescription>Tuning for the blob layout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Blob size multiplier</Label>
              <span className="text-sm font-medium" data-testid="text-blob-merge-value">
                {settings.blobMergeMultiplier.toFixed(2)}x
              </span>
            </div>
            <Slider
              value={[mergeIndex]}
              min={0}
              max={MERGE_MULTIPLIER_STEPS.length - 1}
              step={1}
              onValueChange={(v) => update('blobMergeMultiplier', MERGE_MULTIPLIER_STEPS[v[0]])}
              data-testid="slider-blob-merge"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              {MERGE_MULTIPLIER_STEPS.map(step => (
                <span key={step}>{step}</span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Blob size force</Label>
              <span className="text-sm font-medium" data-testid="text-blob-force-value">
                {settings.blobForceMultiplier.toFixed(1)}x
              </span>
            </div>
            <Slider
              value={[settings.blobForceMultiplier * 10]}
              min={20}
              max={60}
              step={1}
              onValueChange={(v) => update('blobForceMultiplier', v[0] / 10)}
              data-testid="slider-blob-force"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} data-testid="button-save-graph-defaults">
          Save
        </Button>
        <Button variant="outline" onClick={handleResetDefaults} data-testid="button-reset-graph-defaults">
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
