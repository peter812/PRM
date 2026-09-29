import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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

const SAMPLE_TEXT = `I am so happy and grateful for the wonderful support from my friends and family.
Sometimes I feel anxious about the future, but I trust that things will work out.
There was a surprising and shocking moment that made everyone laugh with joy.
We are excited and hopeful about the upcoming celebration, looking forward to a fantastic party.`;

export default function WordCloudDemoPage() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [shape, setShape] = useState<CloudShape>("rectangle");
  const [colorMode, setColorMode] = useState<ColorMode>("palette");
  const [paletteId, setPaletteId] = useState("ocean");
  const [removeFillerWords, setRemoveFillerWords] = useState(true);
  const [maxWords, setMaxWords] = useState(150);
  const [debouncedText, setDebouncedText] = useState(text);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), 250);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Word Cloud</h1>
        <p className="text-muted-foreground text-lg">
          Paste any text and tune the shape, coloring, and filtering to see the word cloud engine
          in action.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="wc-text">Text</Label>
              <Textarea
                id="wc-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste text here..."
              />
            </div>

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
              <Label htmlFor="wc-filler">Remove filler words</Label>
              <Switch
                id="wc-filler"
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
            <WordCloud
              text={debouncedText}
              shape={shape}
              colorMode={colorMode}
              paletteId={paletteId}
              removeFillerWords={removeFillerWords}
              maxWords={maxWords}
              height={560}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
