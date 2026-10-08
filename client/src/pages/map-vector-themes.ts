/**
 * Vector map themes. Color values are from Terraink (https://terraink.app,
 * github.com/yousifamanuel/terraink, src/data/themes.json); applyVectorTheme()
 * recolors CARTO's Positron style with them.
 */
export interface VectorTheme {
  name: string;
  text: string; // label color
  land: string;
  landcover: string;
  water: string;
  waterway: string;
  parks: string;
  buildings: string;
  aeroway: string;
  rail: string;
  roads: { major: string; minor_high: string; minor_mid: string; minor_low: string; path: string; outline: string };
}

export const VECTOR_THEMES: Record<string, VectorTheme> = {
  midnight_blue: {"name":"Midnight Blue","text":"#D6B352","land":"#0A1628","landcover":"#0D1C2F","water":"#061020","waterway":"#061020","parks":"#0F2235","buildings":"#6E5A45","aeroway":"#0F2235","rail":"#d6b352","roads":{"major":"#C99C37","path":"#414033","outline":"#4f4b36","minor_high":"#8A6820","minor_mid":"#333530","minor_low":"#272c2e"}},
  terracotta: {"name":"Terracotta","text":"#8B4513","land":"#F5EDE4","landcover":"#EFE7DA","water":"#A8C4C4","waterway":"#A8C4C4","parks":"#E8E0D0","buildings":"#D9A08A","aeroway":"#E8E0D0","rail":"#8b4513","roads":{"major":"#A0522D","path":"#E4C8B0","outline":"#EAD4C0","minor_high":"#C07048","minor_mid":"#DCA882","minor_low":"#D8B898"}},
  neon: {"name":"Neon","text":"#00F5FF","land":"#0B0F1A","landcover":"#130D22","water":"#001433","waterway":"#002044","parks":"#1A0B2A","buildings":"#FF2D95","aeroway":"#1A0B2A","rail":"#00F5FF","roads":{"major":"#FF2D95","path":"#21203A","outline":"#0B0F1A","minor_high":"#FF6EB4","minor_mid":"#8A33FF","minor_low":"#4A0099"}},
  sage: {"name":"Sage","text":"#2D4739","land":"#DDE8DD","landcover":"#D8E4DA","water":"#C5D4CB","waterway":"#C5D4CB","parks":"#D3DFD7","buildings":"#8BAD9B","aeroway":"#D3DFD7","rail":"#2d4739","roads":{"major":"#3F624F","path":"#BECCBF","outline":"#C8D8CC","minor_high":"#587A68","minor_mid":"#92B4A2","minor_low":"#AABFB4"}},
  ocean: {"name":"Ocean","text":"#1A5F7A","land":"#F0F8FA","landcover":"#E4F1F1","water":"#B8D8E8","waterway":"#B8D8E8","parks":"#D8EAE8","buildings":"#67AED0","aeroway":"#D8EAE8","rail":"#1a5f7a","roads":{"major":"#14536A","path":"#BCD8E8","outline":"#CCE4F0","minor_high":"#2878A0","minor_mid":"#7ABCD4","minor_low":"#AACCE0"}},
  carrara: {"name":"Carrara","text":"#2E2A26","land":"#F4F1EA","landcover":"#ECE7DD","water":"#C7CDD0","waterway":"#C7CDD0","parks":"#E6E3D8","buildings":"#E0DACD","aeroway":"#DAD4C7","rail":"#2E2A26","roads":{"major":"#3A3631","minor_high":"#565049","minor_mid":"#6E675E","minor_low":"#8B8378","path":"#A89F92","outline":"#F4F1EA"}},
};

type Layer = { id: string; type: string; paint?: Record<string, unknown>; [k: string]: unknown };

function roadColor(id: string, t: VectorTheme): string | null {
  if (!/^(tunnel|road|bridge)_/.test(id)) return null;
  if (id.endsWith("_case") || id.includes("_case_")) return t.roads.outline;
  if (id.includes("path")) return t.roads.path;
  if (id.includes("service")) return t.roads.minor_low;
  if (id.includes("minor")) return t.roads.minor_mid;
  if (id.includes("sec")) return t.roads.minor_high;
  return t.roads.major; // pri / trunk / mot
}

/** Recolors a CARTO Positron style.json (layer ids per CartoDB/basemap-styles) with a theme. */
export function applyVectorTheme<S extends { layers: Layer[] }>(style: S, t: VectorTheme): S {
  const layers = style.layers.map((layer) => {
    const { id, type } = layer;
    const paint: Record<string, unknown> = { ...layer.paint };
    const set = (prop: string, color: string) => {
      paint[prop] = color;
    };
    if (type === "background") set("background-color", t.land);
    else if (type === "symbol") {
      set("text-color", t.text);
      set("text-halo-color", /^(watername|waterway_label)/.test(id) ? t.water : t.land);
    } else if (/^(landcover|landuse)/.test(id)) set("fill-color", t.landcover);
    else if (id.startsWith("park_")) set("fill-color", t.parks);
    else if (id === "water" || id === "water_shadow") set("fill-color", t.water);
    else if (id === "waterway") set("line-color", t.waterway);
    else if (id.startsWith("aeroway")) set("line-color", t.aeroway);
    else if (id.startsWith("building")) set("fill-color", t.buildings);
    else if (id.startsWith("boundary")) set("line-color", t.roads.minor_low);
    else if (/rail_dash$/.test(id)) set("line-color", t.land);
    else if (/(^|_)rail$/.test(id)) set("line-color", t.rail);
    else {
      const road = roadColor(id, t);
      if (road) set("line-color", road);
    }
    return { ...layer, paint };
  });
  return { ...style, layers };
}
