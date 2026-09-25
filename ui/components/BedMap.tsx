"use client";

import { bedLabel, bedNumber } from "@/lib/plan";
import type { Bed, Level, Stage } from "@/lib/types";
import { Drop, Sun } from "./icons";

// The bed map is the memory, visualized: six raised beds top-down, each drawn
// from the plan's current crop and growth stage.

type Family = "leaf" | "fruit" | "root" | "allium" | "legume" | "cover";

const CROPS: [RegExp, Family, string, string][] = [
  // pattern, family, foliage, fruit/accent
  [/tomato/, "fruit", "#5d8a45", "#d2452c"],
  [/pepper/, "fruit", "#4f7f3c", "#d9532b"],
  [/eggplant/, "fruit", "#55733f", "#5b2a58"],
  [/squash|zucchini|pumpkin|cucumber/, "fruit", "#6f9a4a", "#e2a83a"],
  [/carrot|parsnip/, "root", "#6ea04c", "#e07b2a"],
  [/beet|radish/, "root", "#5b8a43", "#a3283f"],
  [/garlic|onion|leek|shallot/, "allium", "#8aa56c", "#efe6d3"],
  [/bean|pea/, "legume", "#5f9346", "#8cbf5a"],
  [/clover|rye|vetch|cover/, "cover", "#6c9a4f", "#f4f0e6"],
  [/kale|cabbage|broccoli|collard/, "leaf", "#4d6f5c", "#4d6f5c"],
  [/lettuce/, "leaf", "#96bd62", "#96bd62"],
  [/basil/, "leaf", "#5f9a45", "#5f9a45"],
];

function cropStyle(crop: string): [Family, string, string] {
  const c = crop.toLowerCase();
  const hit = CROPS.find(([re]) => re.test(c));
  return hit ? [hit[1], hit[2], hit[3]] : ["leaf", "#4f7d3e", "#4f7d3e"];
}

const SCALE: Record<Stage, number> = {
  empty: 0, seed: 0, seedling: 0.42, vegetative: 0.72, flowering: 0.88, fruiting: 1, harvest: 1, dormant: 0,
};

function Plant({ x, y, i, family, leaf, accent, stage }: { x: number; y: number; i: number; family: Family; leaf: string; accent: string; stage: Stage }) {
  const s = SCALE[stage];
  const rot = ((i * 47) % 60) - 30;
  const t = `translate(${x} ${y}) rotate(${rot}) scale(${s})`;
  const flowers = stage === "flowering";
  const fruit = stage === "fruiting" || stage === "harvest";

  if (family === "root" || family === "allium") {
    const blades = family === "root" ? [-40, -20, 0, 20, 40, -60, 60] : [-18, 0, 18];
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        {s >= 0.7 && family === "root" && <ellipse cx="0" cy="4" rx="5" ry="3" fill={accent} />}
        {blades.map((a) => (
          <path key={a} d="M0 2 C 2 -8, -2 -14, 0 -22" stroke={leaf} strokeWidth={family === "root" ? 1.4 : 3} fill="none" strokeLinecap="round" transform={`rotate(${a})`} />
        ))}
      </g>
    );
  }
  if (family === "cover") {
    return (
      <g transform={t}>
        {[0, 120, 240].map((a) => (
          <circle key={a} cx="0" cy="-6" r="6" fill={leaf} transform={`rotate(${a})`} />
        ))}
        {flowers && <circle r="3" fill={accent} />}
      </g>
    );
  }
  if (family === "legume") {
    return (
      <g transform={t}>
        <path d="M-14 12 C -6 -4, 6 4, 2 -16 S 14 -8, 12 -20" stroke={leaf} strokeWidth="2" fill="none" />
        {[[-8, 2], [3, -6], [8, -16]].map(([lx, ly], k) => (
          <ellipse key={k} cx={lx} cy={ly} rx="7" ry="4.5" fill={leaf} transform={`rotate(${k * 50 - 30} ${lx} ${ly})`} />
        ))}
        {fruit && <path d="M-2 6 q 6 8 2 16" stroke={accent} strokeWidth="3.4" strokeLinecap="round" fill="none" />}
        {flowers && <circle cx="-3" cy="-4" r="2.6" fill="#f3efe4" />}
      </g>
    );
  }
  const leaves = family === "fruit" ? 6 : 7;
  return (
    <g transform={t}>
      {Array.from({ length: leaves }, (_, k) => (
        <ellipse key={k} cx="0" cy="-10" rx="7" ry="12" fill={leaf} opacity={0.82 + (k % 2) * 0.18} transform={`rotate(${(360 / leaves) * k})`} />
      ))}
      <circle r="4" fill={leaf} />
      {family === "fruit" && flowers && [0, 130, 250].map((a) => <circle key={a} cx="0" cy="-9" r="2.6" fill="#f2cf4a" transform={`rotate(${a})`} />)}
      {family === "fruit" && fruit && [20, 150, 270].map((a) => <circle key={a} cx="0" cy="-10" r="4.6" fill={accent} stroke="rgba(0,0,0,.15)" transform={`rotate(${a})`} />)}
    </g>
  );
}

function BedSvg({ bed }: { bed: Bed }) {
  const [family, leaf, accent] = cropStyle(bed.crop);
  const cols = family === "cover" ? 6 : 4;
  const rows = family === "cover" ? 3 : 2;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) pts.push([16 + (168 * (c + 0.5)) / cols + (r % 2) * 6 - 3, 18 + (94 * (r + 0.5)) / rows]);

  return (
    <svg viewBox="0 0 200 130" role="img" aria-label={`Bed ${bedNumber(bed.id)}: ${bedLabel(bed)}, ${bed.stage}`}>
      <rect x="3" y="3" width="194" height="124" rx="9" fill="#9a6b45" />
      <rect x="3" y="3" width="194" height="124" rx="9" fill="none" stroke="#7d5334" strokeWidth="2" />
      <path d="M3 45 H197 M3 88 H197" stroke="#8a5d3a" strokeWidth="1" opacity="0.4" />
      <rect x="13" y="13" width="174" height="104" rx="4" fill={bed.stage === "dormant" ? "#6e5840" : "#5b3f2c"} />
      {[30, 52, 74, 96].map((y) => (
        <path key={y} d={`M20 ${y} Q 100 ${y + 3} 180 ${y}`} stroke="#6e4d36" strokeWidth="2" fill="none" opacity="0.8" />
      ))}
      {bed.stage === "dormant" &&
        Array.from({ length: 26 }, (_, k) => (
          <path key={k} d={`M${22 + ((k * 37) % 150)} ${24 + ((k * 23) % 80)} l12 ${(k % 3) - 1}`} stroke="#c9a764" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
        ))}
      {bed.stage === "seed" &&
        pts.map(([x, y], k) => (
          <g key={k}>
            <circle cx={x - 5} cy={y} r="1.8" fill="#caa57a" />
            <circle cx={x + 5} cy={y + 1} r="1.8" fill="#caa57a" />
          </g>
        ))}
      {bed.crop && SCALE[bed.stage] > 0 &&
        pts.map(([x, y], k) => <Plant key={k} x={x} y={y} i={k} family={family} leaf={leaf} accent={accent} stage={bed.stage} />)}
    </svg>
  );
}

const levels: Record<Level, number> = { low: 1, med: 2, high: 3 };

function Needs({ icon, level, label }: { icon: "sun" | "water"; level: Level; label: string }) {
  const Icon = icon === "sun" ? Sun : Drop;
  return (
    <span title={`${label}: ${level}`} aria-label={`${label}: ${level}`} style={{ display: "inline-flex" }}>
      {[1, 2, 3].map((n) => (
        <Icon key={n} size={12} className={n > levels[level] ? "icon-dim" : undefined} />
      ))}
    </span>
  );
}

export default function BedMap({ beds, changed }: { beds: Bed[]; changed: Set<string> }) {
  return (
    <div className="bedmap-ground">
      <div className="beds">
        {beds.map((bed) => (
          <div key={bed.id} className={`bed${changed.has(bed.id) ? " changed" : ""}`} tabIndex={0}>
            <BedSvg bed={bed} />
            <div className="bed-note" role="tooltip">
              {bed.crop && bed.planted && <div><b>Planted</b> {bed.planted}</div>}
              {bed.note || "No notes yet."}
            </div>
            <div className="bed-label">
              <span className="no">{bedNumber(bed.id)}</span>
              <b>{bedLabel(bed)}</b>
              <span className="needs">
                <Needs icon="sun" level={bed.sun} label="Sun" />
                <Needs icon="water" level={bed.water} label="Water" />
              </span>
            </div>
            <div className="bed-stage">{bed.crop ? bed.stage : bed.stage === "dormant" ? "mulched for winter" : "open soil"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
