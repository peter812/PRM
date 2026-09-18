import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  POSTS_COMMENTS_KEY,
  POSTS_COMMENT_LIMITS,
  POSTS_COMMENT_LIMIT_KEY,
  POSTS_SCAN_LIMIT_KEY,
  POSTS_VIDEOS_KEY,
  parsePostSettings,
} from "@shared/interest-level";
import type { Settings } from "@/lib/instagram";

/** What a posts check fetches (account-tracking-plan.md §3.4). Applies to every importer. */
export default function InstagramPostsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const posts = parsePostSettings(settings ?? {});
  const save = useMutation({
    mutationFn: async (body: { key: string; value: string }) => apiRequest("POST", "/api/settings", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: (error: Error) => toast({ title: "Failed to save setting", description: error.message, variant: "destructive" }),
  });
  const commitScanLimit = (text: string) => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n !== posts.scanLimit) save.mutate({ key: POSTS_SCAN_LIMIT_KEY, value: String(n) });
  };

  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A posts check walks an account's grid newest first and imports every post PRM doesn't have yet at full
          quality: images, tagged people, caption, counts and music. Posts that vanished from the scanned part of the
          grid are marked deleted, never removed.
        </p>
      </div>

      {settings && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">What a check fetches</CardTitle>
            <CardDescription>Only admins can change these. They apply to every importer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="posts-scan-limit">Posts scanned per check</Label>
              <Input
                id="posts-scan-limit"
                type="number"
                min={1}
                className="h-8 w-28"
                disabled={!isAdmin}
                defaultValue={posts.scanLimit}
                key={posts.scanLimit}
                onBlur={(e) => commitScanLimit(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                data-testid="input-posts-scan-limit"
              />
              <p className="text-xs text-muted-foreground">
                How far back each check looks. Older posts are neither imported nor marked deleted.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 md:max-w-md">
              <div>
                <Label htmlFor="posts-videos">Download videos</Label>
                <p className="text-xs text-muted-foreground">Store the video file for video posts and reels. Off keeps only the cover frame.</p>
              </div>
              <Switch
                id="posts-videos"
                checked={posts.videos}
                disabled={!isAdmin}
                onCheckedChange={(v) => save.mutate({ key: POSTS_VIDEOS_KEY, value: String(v) })}
                data-testid="switch-posts-videos"
              />
            </div>

            <div className="flex items-center justify-between gap-4 md:max-w-md">
              <div>
                <Label htmlFor="posts-comments">Import comments</Label>
                <p className="text-xs text-muted-foreground">Opens every new post on its own page, which makes a check slower.</p>
              </div>
              <Switch
                id="posts-comments"
                checked={posts.comments}
                disabled={!isAdmin}
                onCheckedChange={(v) => save.mutate({ key: POSTS_COMMENTS_KEY, value: String(v) })}
                data-testid="switch-posts-comments"
              />
            </div>

            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="posts-comment-limit">Comments per post</Label>
              <Select
                value={String(posts.commentLimit)}
                disabled={!isAdmin || !posts.comments}
                onValueChange={(v) => save.mutate({ key: POSTS_COMMENT_LIMIT_KEY, value: v })}
              >
                <SelectTrigger id="posts-comment-limit" data-testid="select-posts-comment-limit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSTS_COMMENT_LIMITS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n === 100 ? "All (up to 100)" : String(n)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
