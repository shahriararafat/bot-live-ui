import type { BotSlug } from "@/lib/bots";
import { SPRITES } from "@/lib/sprites";
import type { Status } from "@/lib/types";

export type CharacterMode = Status | "stale";

type Rect = { x: number; y: number; w: number; c: string };

function raster(rows: string[], colors: Record<string, string>): Rect[] {
  const rects: Rect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const c = colors[ch];
      if (!c) {
        x += 1;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w += 1;
      rects.push({ x, y, w, c });
      x += w;
    }
  });
  return rects;
}

export function Character({ slug, mode }: { slug: BotSlug; mode: CharacterMode }) {
  const sprite = SPRITES[slug];
  const rects = raster(sprite.rows, sprite.colors);
  const width = sprite.rows[0].length;
  const height = sprite.rows.length;

  return (
    <div className={`relative h-16 w-16 shrink-0 ${mode === "working" ? "sprite-working" : ""} ${mode === "stale" ? "sprite-stale" : ""}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-16" shapeRendering="crispEdges" aria-hidden="true">
        {rects.map((rect) => (
          <rect key={`${rect.x}-${rect.y}-${rect.w}-${rect.c}`} x={rect.x} y={rect.y} width={rect.w} height={1} fill={rect.c} />
        ))}
      </svg>
      {mode === "working" ? (
        <span className="absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
          <i className="typing-dot block h-1 w-1 rounded-full bg-[#3a2918]" />
          <i className="typing-dot block h-1 w-1 rounded-full bg-[#3a2918]" />
          <i className="typing-dot block h-1 w-1 rounded-full bg-[#3a2918]" />
        </span>
      ) : null}
      {mode === "waiting" ? (
        <span className="q-bubble absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#f0a202] text-[11px] font-black text-[#2b241c] ring-2 ring-[#2b241c]">
          ?
        </span>
      ) : null}
      {mode === "done" ? (
        <span className="absolute -right-1 bottom-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#2faf6a] text-[11px] font-black text-white ring-2 ring-[#2b241c]">
          ✓
        </span>
      ) : null}
      {mode === "stale" ? (
        <span className="absolute -right-0.5 top-0 text-[10px] font-black text-[#8a7362]">z</span>
      ) : null}
    </div>
  );
}
