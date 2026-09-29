import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
import { COLOR_SCHEMES } from "@/lib/wordcloud";
import type { CloudShape } from "@/lib/wordcloud";

interface BiosResponse {
  count: number;
  text: string;
}

export default function BioWordCloudDemoPage() {
  const [shape, setShape] = useState<CloudShape>("rectangle");
  const [colorMode, setColorMode] = useState<ColorMode>("palette");
  const [paletteId, setPaletteId] = useState("candy");
  const [removeFillerWords, setRemoveFillerWords] = useState(true);
  const [maxWords, setMaxWords] = useState(150);

  const { data, isLoading, error } = useQuery<BiosResponse>({
    queryKey: ["/api/demos/word-cloud/bios"],
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Bio Word Cloud</h1>
        <p className="text-muted-foreground text-lg">
          Every visible social account's bio, combined into one word cloud.
          {data && !isLoading ? ` Pulled from ${data.count} bio${data.count === 1 ? "" : "s"}.` : ""}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
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
              <Label htmlFor="bwc-filler">Remove filler words</Label>
              <Switch
                id="bwc-filler"
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

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex h-[560px] items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading bios...
              </div>
            ) : error ? (
              <div className="flex h-[560px] items-center justify-center text-destructive">
                Failed to load bios.
              </div>
            ) : (
              <WordCloud
                text={data?.text ?? ""}
                shape={shape}
                colorMode={colorMode}
                paletteId={paletteId}
                removeFillerWords={removeFillerWords}
                maxWords={maxWords}
                height={560}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
