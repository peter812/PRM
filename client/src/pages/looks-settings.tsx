import { useState } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function LooksSettingsPage() {
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);

  const handleChange = (value: string) => {
    setTheme(value as ThemeMode);
    setThemeMode(value as ThemeMode);
  };

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Palette className="h-6 w-6" />
          Looks
        </h1>
        <p className="text-muted-foreground mt-1">How the app looks on this device.</p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Color theme</CardTitle>
          <CardDescription>System follows your operating system's light/dark setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={theme} onValueChange={handleChange} className="grid grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <Label
                key={t.value}
                htmlFor={`theme-${t.value}`}
                className="flex flex-col items-center gap-2 rounded-md border p-4 cursor-pointer hover:bg-accent has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id={`theme-${t.value}`} value={t.value} className="sr-only" data-testid={`radio-theme-${t.value}`} />
                <t.icon className="h-5 w-5" />
                <span>{t.label}</span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
