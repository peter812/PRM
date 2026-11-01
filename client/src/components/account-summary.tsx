import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Sparkles, AlertTriangle, CheckCircle2, History, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiBackendNotes } from "@/components/ai-backend-notes";
import { MarkdownMessage } from "@/components/markdown-message";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AccountAiSummary, HistoricalAccountSummary, PostAiSummary, SummaryJob } from "@shared/schema";
import {
  SummaryProgressBar,
  SummaryStatusBadge as JobStatusBadge,
  accountWaitProgress,
  jobStep,
  postJobProgress,
} from "@/components/summary-status";

type PostSummaryResponse = {
  aiSummary: PostAiSummary | null;
  aiSummaryAt: string | null;
  aiSummaryModel: string | null;
  job: SummaryJob | null;
};

export function PostSummarySection({
  postId,
  initialSummary,
  currentImageIndex,
  isStory,
}: {
  postId: string;
  initialSummary?: PostAiSummary | unknown;
  currentImageIndex?: number;
  /** Stories have one summary and no per-image descriptions, so Fix corrects the whole story. */
  isStory?: boolean;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);

  const { data } = useQuery<PostSummaryResponse>({
    queryKey: [`/api/social-posts/${postId}/summary`],
    enabled: !!postId,
    refetchInterval: (q) => {
      const st = q.state.data?.job?.status;
      return st === "pending" || st === "running" ? 3000 : false;
    },
  });
  const { data: settings } = useQuery<{ postEnabled: boolean }>({ queryKey: ["/api/summary/settings"] });

  const summarizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/social-posts/${postId}/summary`);
      return res.json() as Promise<{ queued: boolean }>;
    },
    onSuccess: ({ queued }) => {
      toast({ title: queued ? "Post summary queued" : "Post summary already in queue" });
      queryClient.invalidateQueries({ queryKey: [`/api/social-posts/${postId}/summary`] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue post summary", description: err.message, variant: "destructive" });
    },
  });

  const [fixText, setFixText] = useState<string | null>(null);
  const fixMutation = useMutation({
    mutationFn: async ({ imageIndex, text }: { imageIndex: number; text: string }) => {
      const res = await apiRequest("POST", `/api/social-posts/${postId}/images/${imageIndex}/append`, { text });
      return res.json() as Promise<{ queued: boolean }>;
    },
    onSuccess: () => {
      setFixText(null);
      toast({ title: "Fix queued", description: "The image is being re-described with your correction." });
      queryClient.invalidateQueries({ queryKey: [`/api/social-posts/${postId}/summary`] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue fix", description: err.message, variant: "destructive" });
    },
  });

  const summary = (data?.aiSummary ?? initialSummary ?? null) as PostAiSummary | null;
  const job = data?.job;
  const isRunning = job?.status === "pending" || job?.status === "running";
  // Summaries from before jobs were tracked (or whose job was cleared) count as finished.
  const step = job ? jobStep(job.status) : summary ? "done" : null;
  const progressCount = isRunning ? postJobProgress(job?.progress) : null;
  const currentImage =
    currentImageIndex !== undefined ? summary?.images?.find((img) => img.imageIndex === currentImageIndex) : undefined;
  const imageDesc = currentImage?.description;
  const canFix = isStory ? !!summary : !!currentImage?.description;
  const fixes = (isStory ? summary?.appended : currentImage?.appended) ?? [];

  return (
    <div className="rounded-md bg-muted/50 p-2.5 space-y-2" data-testid="post-summary-section">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs text-muted-foreground font-medium flex items-center gap-1 hover:text-foreground"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          data-testid="button-toggle-post-summary"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Summary
        </button>
        {step && <JobStatusBadge step={step} />}
        <span className="flex-1" />
        {settings?.postEnabled && canFix && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setFixText((t) => (t === null ? "" : null))}
            disabled={fixMutation.isPending || isRunning}
            data-testid="button-fix-image"
          >
            Fix
          </Button>
        )}
        {settings?.postEnabled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => summarizeMutation.mutate()}
            disabled={summarizeMutation.isPending || isRunning}
            data-testid="button-summarize-post"
          >
            {summarizeMutation.isPending || isRunning ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Summarizing...
              </>
            ) : summary ? (
              "Regen"
            ) : (
              "Summarize"
            )}
          </Button>
        )}
      </div>

      {progressCount && <SummaryProgressBar count={progressCount} label="steps" />}

      {fixText !== null && currentImageIndex !== undefined && (
        <div className="space-y-1.5" data-testid="fix-image-form">
          <Textarea
            value={fixText}
            onChange={(e) => setFixText(e.target.value)}
            placeholder="What did the summary get wrong? e.g. the boy is her nephew Sam, not her son"
            className="text-xs min-h-[60px]"
            maxLength={1000}
            autoFocus
            data-testid="input-fix-image"
          />
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setFixText(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={!fixText.trim() || fixMutation.isPending}
              onClick={() => fixMutation.mutate({ imageIndex: currentImageIndex, text: fixText.trim() })}
              data-testid="button-save-fix"
            >
              {fixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}

      {expanded && job?.status === "failed" && job.error && (
        <p className="text-[11px] text-destructive">Failed: {job.error}</p>
      )}

      {!expanded ? null : summary ? (
        <div className="space-y-1.5">
          <p className="text-xs whitespace-pre-wrap leading-relaxed" data-testid="text-post-ai-overview">
            {summary.overview}
          </p>
          {imageDesc && summary.images.length > 1 && (
            <p className="text-[11px] text-muted-foreground border-t pt-1.5">
              <span className="font-medium">Slide {(currentImageIndex ?? 0) + 1}:</span> {imageDesc}
            </p>
          )}
          {fixes.map((text, i) => (
            <p key={i} className="text-[11px] text-muted-foreground italic" data-testid="text-image-fix">
              <span className="font-medium not-italic">You:</span> {text}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No summary generated yet.</p>
      )}
    </div>
  );
}

export type AccountSummaryApiResponse = {
  current: {
    content: AccountAiSummary;
    generatedAt: string | null;
    model: string | null;
  } | null;
  invalidated: boolean;
  invalidatedAt: string | null;
  /** Empty unless fetched with `withHistory`. */
  history: HistoricalAccountSummary[];
  historyCount: number;
  activeJobs: SummaryJob[];
  lastError: string | null;
};

function useAccountSummary(socialAccountId: string, withHistory = false) {
  const { toast } = useToast();

  const query = useQuery<AccountSummaryApiResponse>({
    queryKey: [`/api/social-accounts/${socialAccountId}/summary`, withHistory ? { history: 1 } : null],
    enabled: !!socialAccountId,
    refetchInterval: (q) => ((q.state.data?.activeJobs?.length ?? 0) > 0 ? 3000 : false),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/social-accounts/${socialAccountId}/summary`);
      return res.json() as Promise<{ postsQueued: number; accountsQueued: number }>;
    },
    onSuccess: ({ postsQueued, accountsQueued }) => {
      toast({
        title: accountsQueued > 0 ? "Summary queued" : "Summary already in progress",
        description: postsQueued > 0 ? `Queued ${postsQueued} unsummarized post(s) first.` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${socialAccountId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/summary-queue"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue summary", description: err.message, variant: "destructive" });
    },
  });

  return { ...query, generateMutation };
}

const liveAccountJob = (data: AccountSummaryApiResponse | undefined) => data?.activeJobs?.find((j) => j.kind === "account");

/** A live or failed account job shows its job status; otherwise the badge shows how fresh the summary is. */
function SummaryStatusBadge({ data }: { data: AccountSummaryApiResponse | undefined }) {
  const accountJob = liveAccountJob(data);
  if (accountJob) return <JobStatusBadge step={jobStep(accountJob.status)} />;
  if (data?.lastError) return <JobStatusBadge step="failed" />;
  if (!data?.current) {
    return (
      <Badge variant="outline" className="text-[10px] font-medium border-0 bg-muted text-muted-foreground">
        Not summarized
      </Badge>
    );
  }
  if (data.invalidated) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] font-medium border-0 bg-amber-500/15 text-amber-700 dark:text-amber-400"
        data-testid="badge-summary-out-of-date"
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        Out of date
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-medium border-0 bg-green-500/15 text-green-700 dark:text-green-400"
      data-testid="badge-summary-up-to-date"
    >
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Up to date
    </Badge>
  );
}

/** While the account job is queued behind its post summaries. */
function AccountWaitBar({ data }: { data: AccountSummaryApiResponse | undefined }) {
  const accountJob = liveAccountJob(data);
  if (accountJob?.status !== "pending") return null;
  const livePosts = data?.activeJobs.filter((j) => j.kind === "post").length ?? 0;
  const count = accountWaitProgress(accountJob.options, livePosts);
  return count ? <SummaryProgressBar count={count} label="posts summarized" /> : null;
}

/**
 * Expandable Summary card placed to the right of the OSINT card on the Social Account overview.
 */
export function AccountSummaryCard({
  socialAccountId,
  onOpenSummaryTab,
}: {
  socialAccountId: string;
  onOpenSummaryTab: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, generateMutation } = useAccountSummary(socialAccountId);
  const activeCount = data?.activeJobs?.length ?? 0;

  return (
    <Card className="p-4 space-y-3 shadow-none" data-testid="card-account-summary">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex-1 flex items-center gap-2 font-semibold text-sm text-left"
          onClick={() => setOpen(!open)}
          data-testid="button-toggle-summary-card"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          Summary
        </button>
        <SummaryStatusBadge data={data} />
      </div>
      <AccountWaitBar data={data} />

      {open && (
        <div className="space-y-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {data?.invalidated && (
                <div
                  className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
                  data-testid="banner-summary-card-invalidated"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Summary is out of date
                    {data.invalidatedAt ? ` (invalidated ${new Date(data.invalidatedAt).toLocaleString()})` : ""}.
                  </span>
                </div>
              )}

              {data?.lastError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Last run failed: {data.lastError}
                </div>
              )}

              {data?.current ? (
                <div className="space-y-2">
                  <MarkdownMessage
                    content={data.current.content.profile}
                    className="text-xs leading-relaxed line-clamp-6"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {data.current.generatedAt && (
                      <span>Generated: {new Date(data.current.generatedAt).toLocaleString()}</span>
                    )}
                    {data.current.model && <Badge variant="secondary" className="text-[10px]">{data.current.model}</Badge>}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No summary generated yet.</p>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-primary"
                  onClick={onOpenSummaryTab}
                  data-testid="button-open-summary-tab"
                >
                  <History className="h-3.5 w-3.5 mr-1" />
                  Full &amp; Historical ({data?.historyCount ?? 0})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending || activeCount > 0}
                  data-testid="button-generate-account-summary"
                >
                  {generateMutation.isPending || activeCount > 0 ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  {data?.current ? "Update summary" : "Generate summary"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Full Social Account Summary Subpage / Tab showing the current summary, invalidation status, and historical summaries.
 */
export function SocialAccountSummaryTab({ socialAccountId }: { socialAccountId: string }) {
  const { data, isLoading, generateMutation } = useAccountSummary(socialAccountId, true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeCount = data?.activeJobs?.length ?? 0;

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1" data-testid="tab-content-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Account Summary
            <SummaryStatusBadge data={data} />
          </h2>
          <p className="text-xs text-muted-foreground">
            Current synthesized profile summary and archived historical versions.
          </p>
          <div className="max-w-xs mt-1">
            <AccountWaitBar data={data} />
          </div>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || activeCount > 0}
          size="sm"
          data-testid="button-tab-generate-summary"
        >
          {generateMutation.isPending || activeCount > 0 ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1.5" />
          )}
          {data?.current ? "Update Summary" : "Generate Summary"}
        </Button>
      </div>

      {data?.invalidated && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
          data-testid="banner-summary-tab-invalidated"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This account summary is <strong>out of date</strong> because new post or story summaries were added
              {data.invalidatedAt ? ` on ${new Date(data.invalidatedAt).toLocaleString()}` : ""}.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || activeCount > 0}
          >
            Update Now
          </Button>
        </div>
      )}

      {data?.lastError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Last summary generation failed: {data.lastError}
        </div>
      )}

      {/* Current Summary */}
      <Card data-testid="card-current-account-summary">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Current Summary</CardTitle>
            {data?.current && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {data.current.model && <Badge variant="secondary">{data.current.model}</Badge>}
                {data.current.generatedAt && (
                  <span>Generated: {new Date(data.current.generatedAt).toLocaleString()}</span>
                )}
                {data.invalidatedAt && (
                  <span className="text-amber-600 dark:text-amber-400">
                    Invalidated: {new Date(data.invalidatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
          {data?.current?.content && (
            <CardDescription className="text-xs">
              Covers {data.current.content.postCount ?? 0} post(s) and {data.current.content.storyCount ?? 0} story/stories
              {data.current.content.connectionCount ? ` and ${data.current.content.connectionCount} connection(s)` : ""}.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {data?.current ? (
            <MarkdownMessage content={data.current.content.profile} className="text-sm leading-relaxed" />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No summary has been generated for this account yet. Click &ldquo;Generate Summary&rdquo; above to create one.
            </p>
          )}
        </CardContent>
      </Card>

      <AiBackendNotes kind="social-accounts" id={socialAccountId} />

      {/* Historical Summaries */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Historical Account Summaries ({data?.history?.length ?? 0})
        </h3>

        {data?.history && data.history.length > 0 ? (
          <div className="space-y-3" data-testid="list-historical-summaries">
            {data.history.map((item) => {
              const isExpanded = expandedHistoryId === item.id;
              return (
                <Card key={item.id} className="p-4 space-y-3" data-testid={`historical-summary-${item.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left font-medium text-sm"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : item.id)}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      <span>Replaced {new Date(item.replacedAt).toLocaleString()}</span>
                      <span className="text-xs font-mono text-muted-foreground">({item.id.slice(0, 8)})</span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {item.model && <Badge variant="outline">{item.model}</Badge>}
                      <span>Created: {new Date(item.createdAt).toLocaleString()}</span>
                      {item.invalidatedAt && (
                        <span>Invalidated: {new Date(item.invalidatedAt).toLocaleString()}</span>
                      )}
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="pt-2 border-t space-y-2">
                      <div className="text-[11px] text-muted-foreground font-mono">UUID: {item.id}</div>
                      <MarkdownMessage content={item.content?.profile ?? ""} className="text-sm leading-relaxed" />
                    </div>
                  ) : (
                    <MarkdownMessage
                      content={item.content?.profile ?? ""}
                      className="text-xs text-muted-foreground line-clamp-2"
                    />
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-6 text-center text-sm text-muted-foreground italic">
            No historical summaries archived yet. When an existing summary is updated, the previous version is saved here.
          </Card>
        )}
      </div>
    </div>
  );
}
