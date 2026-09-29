export interface ColorScheme {
  id: string;
  label: string;
  colors: string[];
}

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: "ocean",
    label: "Ocean",
    colors: ["#0a4d68", "#0e7c9d", "#3fa7c9", "#7fd8e0", "#12b1a3", "#1e5f74"],
  },
  {
    id: "sunset",
    label: "Sunset",
    colors: ["#ff6b35", "#f7931e", "#ffcc00", "#ee4266", "#c3423f", "#9a031e"],
  },
  {
    id: "forest",
    label: "Forest",
    colors: ["#2d6a4f", "#40916c", "#74c69d", "#95d5b2", "#1b4332", "#52796f"],
  },
  {
    id: "mono",
    label: "Monochrome",
    colors: ["#1a1a2e", "#3d3d5c", "#5c5c8a", "#8888b0", "#b0b0d0", "#dcdcf0"],
  },
  {
    id: "candy",
    label: "Candy",
    colors: ["#f72585", "#b5179e", "#7209b7", "#560bad", "#480ca8", "#3a0ca3"],
  },
];

export function getColorScheme(id: string): ColorScheme {
  return COLOR_SCHEMES.find((scheme) => scheme.id === id) ?? COLOR_SCHEMES[0];
}

export function pickColor(scheme: ColorScheme, index: number): string {
  return scheme.colors[index % scheme.colors.length];
}
