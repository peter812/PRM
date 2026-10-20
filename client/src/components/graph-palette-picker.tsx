import { Label } from "@/components/ui/label";
import { GRAPH_PALETTES, paletteGradientCss, type Palette } from "@/lib/social-graph-defaults";

interface GraphPalettePickerProps {
  value: Palette;
  onChange: (stops: Palette) => void;
  lowLabel: string;
  highLabel: string;
  testId: string;
}

/**
 * Preset ramps as clickable swatches, plus pickers for the two ends. Editing an
 * end of a multi-stop preset keeps its middle, so a tweak doesn't flatten it.
 */
export function GraphPalettePicker({ value, onChange, lowLabel, highLabel, testId }: GraphPalettePickerProps) {
  const key = value.join(',');
  const setEnd = (end: 0 | 1, color: string) => {
    const next = [...value];
    next[end === 0 ? 0 : next.length - 1] = color;
    onChange(next);
  };

  return (
    <div className="space-y-2" data-testid={`palette-${testId}`}>
      <div className="grid grid-cols-4 gap-1.5">
        {GRAPH_PALETTES.map((p) => {
          const selected = p.stops.join(',') === key;
          return (
            <button
              key={p.id}
              type="button"
              title={p.name}
              onClick={() => onChange([...p.stops])}
              className={`h-6 rounded border ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
              style={{ background: paletteGradientCss(p.stops) }}
              data-testid={`palette-${testId}-${p.id}`}
            />
          );
        })}
      </div>
      <div className="h-3 rounded-full" style={{ background: paletteGradientCss(value) }} data-testid={`palette-${testId}-preview`} />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="color"
            value={value[0]}
            onChange={(e) => setEnd(0, e.target.value)}
            className="h-7 w-10 rounded cursor-pointer border"
            data-testid={`input-${testId}-low`}
          />
          <Label className="text-xs text-muted-foreground font-normal">{lowLabel}</Label>
        </label>
        <label className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground font-normal">{highLabel}</Label>
          <input
            type="color"
            value={value[value.length - 1]}
            onChange={(e) => setEnd(1, e.target.value)}
            className="h-7 w-10 rounded cursor-pointer border"
            data-testid={`input-${testId}-high`}
          />
        </label>
      </div>
    </div>
  );
}
