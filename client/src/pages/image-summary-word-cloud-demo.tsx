import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WordCloud, type ColorMode } from "@/components/word-cloud";
import { COLOR_SCHEMES, isFillerWord } from "@/lib/wordcloud";
import type { CloudShape } from "@/lib/wordcloud";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ImageSummaryWordCloud } from "@shared/schema";

type RunStatus = Omit<ImageSummaryWordCloud, "words" | "status"> & { status: "running" | "done" | "failed" | "interrupted" };

interface ImageSummariesResponse {
  latest: RunStatus;
  lastDone: ImageSummaryWordCloud | null;
}

const QUERY_KEY = ["/api/demos/word-cloud/image-summaries"];

export default function ImageSummaryWordCloudDemoPage() {
  const [shape, setShape] = useState<CloudShape>("rectangle");
  const [colorMode, setColorMode] = useState<ColorMode>("palette");
  const [paletteId, setPaletteId] = useState("candy");
  const [removeFillerWords, setRemoveFillerWords] = useState(true);
  const [maxWords, setMaxWords] = useState(150);

  const { data, isLoading, error } = useQuery<ImageSummariesResponse | null>({
    queryKey: QUERY_KEY,
    refetchInterval: (query) => (query.state.data?.latest.status === "running" ? 2000 : false),
  });

  const start = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demos/word-cloud/image-summaries/run"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const latest = data?.latest;
  const lastDone = data?.lastDone;
  const running = latest?.status === "running" || start.isPending;

  const words = useMemo(() => {
    const all = lastDone?.words ?? [];
    return (removeFillerWords ? all.filter((w) => !isFillerWord(w.text)) : all).slice(0, maxWords);
  }, [lastDone, removeFillerWords, maxWords]);

  return (
    <div className="h-full overflow-auto">
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Image Summary Word Cloud</h1>
        <p className="text-muted-foreground text-lg">
          The most common words across every AI image summary. Counting reads every summarized
          post, so it runs in the background and the result is saved until you run it again.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Word counts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {lastDone?.finishedAt ? (
                <div className="space-y-1">
                  <div>
                    Finished {formatDistanceToNow(new Date(lastDone.finishedAt), { addSuffix: true })}
                  </div>
                  <div className="text-muted-foreground">
                    {new Date(lastDone.finishedAt).toLocaleString()}
                  </div>
                  <div className="text-muted-foreground">
                    {lastDone.summariesProcessed.toLocaleString()} summaries from{" "}
                    {lastDone.postsProcessed.toLocaleString()} posts,{" "}
                    {lastDone.wordsCounted.toLocaleString()} words
                  </div>
                </div>
              ) : (
                !isLoading && <div className="text-muted-foreground">No word counts yet.</div>
              )}

              {latest?.status === "running" && (
                <div className="space-y-2">
                  <Progress value={latest.postsTotal ? (latest.postsProcessed / latest.postsTotal) * 100 : 0} />
                  <div className="text-muted-foreground">
                    {latest.postsProcessed.toLocaleString()} / {latest.postsTotal.toLocaleString()} posts,{" "}
                    {latest.summariesProcessed.toLocaleString()} summaries
                  </div>
                </div>
              )}
              {(latest?.status === "failed" || latest?.status === "interrupted") && (
                <div className="text-destructive">
                  Last run {latest.status}
                  {latest.error ? `: ${latest.error}` : " (server restarted)"}.
                </div>
              )}
              {start.error && <div className="text-destructive">Failed to start the count.</div>}

              <Button className="w-full" onClick={() => start.mutate()} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {running ? "Counting..." : lastDone ? "Recount" : "Count words"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Shape</Label>
                <Select value={shape} onValueChange={(v) => setShape(v as CloudShape)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rectangle">Rectangle</SelectItem>
                    <SelectItem value="circle">Circle</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Color mode</Label>
                <Select value={colorMode} onValueChange={(v) => setColorMode(v as ColorMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="palette">Palette</SelectItem>
                    <SelectItem value="emotion">Emotion</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {colorMode === "palette" && (
                <div className="space-y-2">
                  <Label>Palette</Label>
                  <Select value={paletteId} onValueChange={setPaletteId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_SCHEMES.map((scheme) => (
                        <SelectItem key={scheme.id} value={scheme.id}>
                          {scheme.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="iswc-filler">Remove filler words</Label>
                <Switch
                  id="iswc-filler"
                  checked={removeFillerWords}
                  onCheckedChange={setRemoveFillerWords}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Max words</Label>
                  <span className="text-sm text-muted-foreground">{maxWords}</span>
                </div>
                <Slider
                  min={20}
                  max={300}
                  step={10}
                  value={[maxWords]}
                  onValueChange={([v]) => setMaxWords(v)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="flex h-[560px] items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Loading word counts...
                </div>
              ) : error ? (
                <div className="flex h-[560px] items-center justify-center text-destructive">
                  Failed to load word counts.
                </div>
              ) : lastDone ? (
                <WordCloud
                  words={words}
                  shape={shape}
                  colorMode={colorMode}
                  paletteId={paletteId}
                  maxWords={maxWords}
                  height={560}
                />
              ) : (
                <div className="flex h-[560px] items-center justify-center text-muted-foreground">
                  Run a word count to build the cloud.
                </div>
              )}
            </CardContent>
          </Card>

          {words.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top words</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                  {words.slice(0, 60).map((w, i) => (
                    <li key={w.text} className="flex justify-between gap-2">
                      <span className="truncate min-w-0">
                        <span className="text-muted-foreground mr-1">{i + 1}.</span>
                        {w.text}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{w.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
