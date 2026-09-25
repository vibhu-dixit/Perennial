import { addDays, applyEdit, emptyPlan, isoDay, planWords } from "./plan.ts";
import type { EditOp, LoopRun, Observation, PlanEdit, PlanVersion, QA } from "./types.ts";

// Two seasons of demo history (PDD §13, hour 2). Last season is written with fixed
// dates; the current season ends with events pinned relative to "now" so the demo
// garden always looks lived-in on the day you run it.

interface SeedEvent {
  date: Date;
  op: EditOp;
  target: string;
  after?: unknown;
  before?: unknown;
  reason: string;
  obs?: { source: "user" | "nimble"; kind: string; text: string };
}

// Deterministic PRNG so every seed produces the same garden.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (y: number, md: string) => new Date(`${y}-${md}T08:00:00Z`);

function lastSeason(y: number): SeedEvent[] {
  const d = (md: string) => at(y, md);
  const user = (text: string, kind = "note") => ({ source: "user" as const, kind, text });
  const nimble = (text: string, kind = "alert") => ({ source: "nimble" as const, kind, text });
  return [
    { date: d("03-08"), op: "UPDATE", target: "beds/bed_1", after: { crop: "spinach", stage: "seed", planted: `${y}-03-08` }, reason: "Logged sowing", obs: user("Sowed spinach (Bloomsdale), bed 1", "plant") },
    { date: d("03-15"), op: "UPDATE", target: "beds/bed_2", after: { crop: "carrots", stage: "seed", planted: `${y}-03-15` }, reason: "Logged sowing", obs: user("Sowed carrots (Nantes), bed 2", "plant") },
    { date: d("03-22"), op: "UPDATE", target: "beds/bed_3", after: { crop: "peas", stage: "seed", planted: `${y}-03-22` }, reason: "Logged sowing", obs: user("Sowed snap peas along the trellis, bed 3", "plant") },
    { date: d("04-05"), op: "UPDATE", target: "beds/bed_1", after: { stage: "seedling" }, reason: "Germination ~4 weeks after sowing", obs: user("Spinach up in bed 1") },
    { date: d("04-12"), op: "ADD", target: "threats/frost_apr", after: { kind: "frost", title: "Frost Tue night (−1°C)", status: "active", reason: "7-day forecast min −1°C" }, reason: "Forecast below freezing", obs: nimble("Forecast: Tue low −1°C, clear skies — frost likely", "forecast") },
    { date: d("04-12"), op: "ADD", target: "tasks/t_fleece_peas", after: { title: "Fleece peas Tue night", due: `${y}-04-14`, priority: "high", reason: "frost risk −1°C Tue" }, reason: "Protect seedlings from frost", obs: nimble("Forecast: Tue low −1°C, clear skies — frost likely", "forecast") },
    { date: d("04-16"), op: "RETIRE", target: "tasks/t_fleece_peas", reason: "Frost passed" },
    { date: d("04-16"), op: "UPDATE", target: "threats/frost_apr", after: { status: "resolved" }, reason: "Frost passed with no damage", obs: user("Peas fine after the frost") },
    { date: d("04-20"), op: "UPDATE", target: "beds/bed_4", after: { crop: "lettuce", stage: "seedling", planted: `${y}-04-20` }, reason: "Logged transplant", obs: user("Transplanted lettuce starts, bed 4", "plant") },
    { date: d("04-26"), op: "ADD", target: "threats/bed2_water", after: { kind: "soil", title: "Bed 2 holding water", status: "watching", reason: "3 days of rain, bed saturated" }, reason: "Soil moisture sensor saturated", obs: nimble("Soil moisture bed 2: saturated after 3 days of rain", "soil") },
    { date: d("05-10"), op: "UPDATE", target: "beds/bed_5", after: { crop: "tomatoes", stage: "vegetative", planted: `${y}-05-10` }, reason: "Logged transplant", obs: user("Transplanted Sungold tomatoes, bed 5", "plant") },
    { date: d("04-10"), op: "UPDATE", target: "beds/bed_5", after: { crop: "lettuce", stage: "seedling", planted: `${y}-04-10` }, reason: "Quick crop before summer", obs: user("Planted lettuce starts, bed 5", "plant") },
    { date: d("05-12"), op: "UPDATE", target: "beds/bed_6", after: { crop: "basil", stage: "seedling", planted: `${y}-05-12` }, reason: "Logged transplant", obs: user("Planted basil, bed 6", "plant") },
    { date: d("05-24"), op: "UPDATE", target: "beds/bed_1", after: { crop: "", stage: "empty" }, reason: "Harvested and cleared", obs: user("Harvested spinach, bed 1 — bolting already", "harvest") },
    { date: d("05-24"), op: "ADD", target: "learnings", after: "Spinach in bed 1 bolts by late May — sow by early March", reason: "Bolting observed at harvest" },
    { date: d("05-28"), op: "ADD", target: "threats/aphids_25", after: { kind: "pest", title: "Aphids 2mi away", status: "watching", reason: "Regional extension alert" }, reason: "Nearby pest pressure", obs: nimble("Extension alert: aphid outbreak reported 2mi away", "pest") },
    { date: d("06-05"), op: "UPDATE", target: "threats/bed2_water", after: { status: "active", title: "Bed 2 waterlogged — carrots yellowing" }, reason: "User reports yellowing tops + soggy soil", obs: user("Carrot tops in bed 2 yellowing, soil still soggy") },
    { date: d("06-10"), op: "UPDATE", target: "beds/bed_5", after: { stage: "flowering" }, reason: "First trusses flowering", obs: user("Tomatoes flowering in bed 5") },
    { date: d("06-12"), op: "UPDATE", target: "beds/bed_1", after: { crop: "beans", stage: "seed", planted: `${y}-06-12` }, reason: "Logged sowing", obs: user("Sowed bush beans, bed 1", "plant") },
    { date: d("06-18"), op: "UPDATE", target: "beds/bed_4", after: { crop: "carrots", stage: "seed", planted: `${y}-06-18` }, reason: "Trial row after lettuce harvest", obs: user("Harvested lettuce; sowed a trial row of carrots in bed 4's sandy soil", "harvest") },
    { date: d("06-20"), op: "UPDATE", target: "threats/aphids_25", after: { status: "active", title: "Aphids on basil" }, reason: "Aphids found on basil", obs: user("Aphids on the basil in bed 6") },
    { date: d("06-20"), op: "ADD", target: "tasks/t_soap", after: { title: "Spray basil with soapy water", due: `${y}-06-21`, priority: "high", reason: "aphids found on basil" }, reason: "Treat active infestation" },
    { date: d("06-28"), op: "RETIRE", target: "tasks/t_soap", reason: "Done — aphids gone" },
    { date: d("06-28"), op: "UPDATE", target: "threats/aphids_25", after: { status: "resolved" }, reason: "No aphids for a week", obs: user("Basil clean, no aphids") },
    { date: d("07-02"), op: "UPDATE", target: "beds/bed_3", after: { crop: "squash", stage: "vegetative", planted: `${y}-07-02` }, reason: "Peas done; squash in", obs: user("Pulled peas, planted squash in bed 3", "harvest") },
    { date: d("07-15"), op: "UPDATE", target: "beds/bed_2", after: { crop: "", stage: "empty" }, reason: "Carrot crop failed", obs: user("Pulled carrots in bed 2 — forked and rotted, maybe 20% usable", "harvest") },
    { date: d("07-15"), op: "RETIRE", target: "threats/bed2_water", reason: "Folded into learnings" },
    { date: d("07-15"), op: "ADD", target: "learnings", after: `Bed 2 waterlogs in wet weeks — carrots forked and rotted there in ${y}. Keep root crops out; try bed 4's sandy soil.`, reason: "Carrot failure + saturated soil readings in bed 2" },
    { date: d("07-20"), op: "UPDATE", target: "beds/bed_5", after: { stage: "fruiting" }, reason: "Fruit set", obs: user("Tomatoes setting fruit") },
    { date: d("08-05"), op: "UPDATE", target: "beds/bed_5", after: { stage: "harvest" }, reason: "Picking daily", obs: user("Tomato harvest, bed 5 — 4 kg this week", "harvest") },
    { date: d("08-25"), op: "UPDATE", target: "beds/bed_4", after: { stage: "harvest" }, reason: "Trial carrots ready", obs: user("Pulled trial carrots in bed 4 — straight and sweet!", "harvest") },
    { date: d("08-25"), op: "ADD", target: "learnings", after: "Bed 4's sandy soil grows straight, sweet carrots — make it the root bed", reason: "Trial row succeeded" },
    { date: d("09-05"), op: "ADD", target: "learnings", after: `Bed 5 tomatoes (Sungold) gave ~14 kg in ${y} — best bed for fruiting crops`, reason: "Season harvest totals", obs: user("Tomato total for the season ~14 kg", "harvest") },
    { date: d("09-15"), op: "UPDATE", target: "beds/bed_1", after: { crop: "", stage: "empty" }, reason: "Beans done", obs: user("Last beans picked, bed 1", "harvest") },
    { date: d("10-10"), op: "UPDATE", target: "beds/bed_5", after: { crop: "", stage: "dormant" }, reason: "First frost ended tomatoes", obs: nimble("First frost recorded: −2°C", "forecast") },
    { date: d("10-10"), op: "UPDATE", target: "beds/bed_6", after: { crop: "", stage: "dormant" }, reason: "First frost ended basil" },
    { date: d("10-12"), op: "UPDATE", target: "beds/bed_3", after: { crop: "", stage: "dormant" }, reason: "Squash cleared", obs: user("Cleared squash, 9 fruit stored", "harvest") },
    { date: d("10-20"), op: "ADD", target: "season_notes", after: `${y}: cool, dry summer; first frost Oct 10`, reason: "Compress season weather into one line" },
    { date: d("10-20"), op: "RETIRE", target: "threats/frost_apr", reason: "Resolved — archived" },
    { date: d("10-20"), op: "RETIRE", target: "threats/aphids_25", reason: "Resolved — archived" },
    { date: d("04-08"), op: "UPDATE", target: "beds/bed_2", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("05-15"), op: "UPDATE", target: "beds/bed_2", after: { stage: "vegetative" }, reason: "Tops filling in" },
    { date: d("04-10"), op: "UPDATE", target: "beds/bed_3", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("05-20"), op: "UPDATE", target: "beds/bed_3", after: { stage: "flowering" }, reason: "Pea flowers open" },
    { date: d("06-10"), op: "UPDATE", target: "beds/bed_3", after: { stage: "fruiting" }, reason: "Pods forming" },
    { date: d("06-10"), op: "UPDATE", target: "beds/bed_6", after: { stage: "vegetative" }, reason: "Basil bushing out" },
    { date: d("06-26"), op: "UPDATE", target: "beds/bed_1", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("07-15"), op: "UPDATE", target: "beds/bed_1", after: { stage: "flowering" }, reason: "Bean flowers" },
    { date: d("08-01"), op: "UPDATE", target: "beds/bed_1", after: { stage: "fruiting" }, reason: "Pods forming" },
    { date: d("07-05"), op: "UPDATE", target: "beds/bed_4", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("07-25"), op: "UPDATE", target: "beds/bed_4", after: { stage: "vegetative" }, reason: "Carrot tops filling in" },
    { date: d("07-20"), op: "UPDATE", target: "beds/bed_3", after: { stage: "flowering" }, reason: "Squash flowering" },
    { date: d("08-10"), op: "UPDATE", target: "beds/bed_3", after: { stage: "fruiting" }, reason: "Squash setting fruit" },
    { date: d("10-25"), op: "UPDATE", target: "beds/bed_3", after: { crop: "garlic", stage: "seed", planted: `${y}-10-25` }, reason: "Overwinter garlic", obs: user("Planted garlic cloves, bed 3", "plant") },
  ];
}

function currentSeason(y: number, now: Date): SeedEvent[] {
  const d = (md: string) => at(y, md);
  const ago = (n: number) => addDays(now, -n);
  const due = (n: number) => isoDay(addDays(now, n));
  const user = (text: string, kind = "note") => ({ source: "user" as const, kind, text });
  const nimble = (text: string, kind = "alert") => ({ source: "nimble" as const, kind, text });
  const fixed: SeedEvent[] = [
    { date: d("03-01"), op: "UPDATE", target: "beds/bed_2", after: { crop: "", stage: "empty" }, reason: "New season" },
    { date: d("03-01"), op: "UPDATE", target: "beds/bed_4", after: { crop: "", stage: "empty" }, reason: "New season" },
    { date: d("03-05"), op: "UPDATE", target: "beds/bed_1", after: { crop: "spinach", stage: "seed", planted: `${y}-03-05` }, reason: "Early sowing per learning (bolting)", obs: user("Sowed spinach, bed 1", "plant") },
    { date: d("03-12"), op: "ADD", target: "season_notes", after: "Wet spring — reduced watering schedule", reason: "Compressed 3 weeks of rain into one note", obs: nimble("Wettest March in 10 years: 79 mm so far", "forecast") },
    { date: d("03-20"), op: "UPDATE", target: "beds/bed_4", after: { crop: "carrots", stage: "seed", planted: `${y}-03-20` }, reason: "Root crops go in bed 4 (learning)", obs: user("Sowed carrots (Nantes), bed 4", "plant") },
    { date: d("03-25"), op: "UPDATE", target: "beds/bed_2", after: { crop: "clover", stage: "seed", planted: `${y}-03-25` }, reason: "Cover crop to open up clay", obs: user("Sowed clover cover crop in bed 2", "plant") },
    { date: d("04-02"), op: "UPDATE", target: "beds/bed_3", after: { crop: "garlic", stage: "vegetative" }, reason: "Overwintered garlic up", obs: user("Garlic greens up in bed 3") },
    { date: d("04-10"), op: "UPDATE", target: "beds/bed_5", after: { crop: "lettuce", stage: "seedling", planted: `${y}-04-10` }, reason: "Quick crop before summer", obs: user("Planted lettuce starts, bed 5", "plant") },
    { date: d("05-12"), op: "UPDATE", target: "beds/bed_6", after: { crop: "tomatoes", stage: "vegetative", planted: `${y}-05-12` }, reason: "Rotate nightshades out of bed 5", obs: user("Transplanted tomatoes, bed 6", "plant") },
    { date: d("05-20"), op: "UPDATE", target: "beds/bed_1", after: { crop: "", stage: "empty" }, reason: "Harvested before bolting", obs: user("Harvested spinach, bed 1 — no bolting this year", "harvest") },
    { date: d("05-20"), op: "UPDATE", target: "learnings", before: "Spinach in bed 1 bolts by late May — sow by early March", after: "Spinach in bed 1: sow by early March, harvest by May 20 (worked)", reason: "Early sowing confirmed" },
    { date: d("06-01"), op: "RETIRE", target: "season_notes", before: "Wet spring — reduced watering schedule", reason: "Spring over; watering back to normal" },
    { date: d("06-10"), op: "UPDATE", target: "beds/bed_1", after: { crop: "beans", stage: "seed", planted: `${y}-06-10` }, reason: "Logged sowing", obs: user("Sowed bush beans, bed 1", "plant") },
    { date: d("06-05"), op: "UPDATE", target: "beds/bed_5", after: { crop: "", stage: "empty" }, reason: "Lettuce harvested", obs: user("Harvested lettuce, bed 5", "harvest") },
    { date: d("06-25"), op: "UPDATE", target: "beds/bed_3", after: { crop: "", stage: "empty" }, reason: "Garlic harvested", obs: user("Lifted garlic, bed 3 — 40 bulbs", "harvest") },
    { date: d("07-05"), op: "ADD", target: "threats/hornworm", after: { kind: "pest", title: "Hornworms on tomatoes", status: "active", reason: "Two found on bed 6" }, reason: "User report", obs: user("Found 2 hornworms on the tomatoes") },
    { date: d("07-10"), op: "UPDATE", target: "beds/bed_3", after: { crop: "kale", stage: "seedling", planted: `${y}-07-10` }, reason: "Logged transplant", obs: user("Transplanted kale, bed 3", "plant") },
    { date: d("07-12"), op: "RETIRE", target: "threats/hornworm", reason: "Hand-picked, none seen since", obs: user("No hornworms for a week") },
    { date: d("07-20"), op: "UPDATE", target: "beds/bed_4", after: { crop: "carrots", stage: "seed", planted: `${y}-07-22` }, reason: "Second sowing", obs: user("Pulled carrots in bed 4 — 6 kg, straight and sweet. Resowed.", "harvest") },
    { date: d("07-20"), op: "UPDATE", target: "learnings", before: "Bed 4's sandy soil grows straight, sweet carrots — make it the root bed", after: "Bed 4 is the root bed: 2 good carrot crops (6 kg first sowing this year)", reason: "Confirmed a second season" },
    { date: d("08-01"), op: "UPDATE", target: "beds/bed_6", after: { stage: "fruiting" }, reason: "Fruit set", obs: user("Tomatoes fruiting") },
    { date: d("08-18"), op: "UPDATE", target: "beds/bed_5", after: { crop: "", stage: "empty", note: "Composted, ready for pepper starts" }, reason: "Prepped for fall peppers", obs: user("Cleared and composted bed 5", "note") },
    { date: d("08-20"), op: "UPDATE", target: "beds/bed_1", after: { crop: "", stage: "empty" }, reason: "Beans finished", obs: user("Last beans, bed 1 — 3 kg total", "harvest") },
    { date: d("03-28"), op: "UPDATE", target: "beds/bed_1", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("04-20"), op: "UPDATE", target: "beds/bed_1", after: { stage: "vegetative" }, reason: "Leaves sizing up" },
    { date: d("04-10"), op: "UPDATE", target: "beds/bed_4", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("05-10"), op: "UPDATE", target: "beds/bed_4", after: { stage: "vegetative" }, reason: "Tops filling in" },
    { date: d("04-20"), op: "UPDATE", target: "beds/bed_2", after: { stage: "vegetative" }, reason: "Clover established" },
    { date: d("06-15"), op: "UPDATE", target: "beds/bed_6", after: { stage: "flowering" }, reason: "First trusses flowering" },
    { date: d("06-24"), op: "UPDATE", target: "beds/bed_1", after: { stage: "seedling" }, reason: "Germinated" },
    { date: d("07-10"), op: "UPDATE", target: "beds/bed_1", after: { stage: "flowering" }, reason: "Bean flowers" },
    { date: d("07-25"), op: "UPDATE", target: "beds/bed_1", after: { stage: "fruiting" }, reason: "Pods forming" },
    { date: d("08-10"), op: "UPDATE", target: "beds/bed_3", after: { stage: "vegetative" }, reason: "Kale sizing up" },
    { date: d("08-25"), op: "UPDATE", target: "beds/bed_4", after: { stage: "seedling" }, reason: "Second sowing up" },
  ];
  const recent: SeedEvent[] = [
    { date: ago(24), op: "UPDATE", target: "beds/bed_1", after: { crop: "spinach", stage: "seed", planted: isoDay(ago(24)) }, reason: "Fall sowing", obs: user("Sowed fall spinach, bed 1", "plant") },
    { date: ago(16), op: "UPDATE", target: "beds/bed_6", after: { stage: "harvest" }, reason: "Picking daily", obs: user("Tomato harvest bed 6 — 3 kg this week", "harvest") },
    { date: ago(12), op: "UPDATE", target: "beds/bed_1", after: { stage: "seedling" }, reason: "Germinated" },
    { date: ago(10), op: "UPDATE", target: "beds/bed_3", after: { stage: "vegetative" }, reason: "Kale sizing up" },
    { date: ago(8), op: "UPDATE", target: "beds/bed_4", after: { stage: "vegetative" }, reason: "Carrots thickening" },
    { date: ago(6), op: "ADD", target: "threats/aphids", after: { kind: "pest", title: "Aphids 2mi away", status: "watching", reason: "Regional extension alert" }, reason: "Nearby pest pressure on brassicas", obs: nimble("Extension alert: aphids on brassicas reported 2mi away", "pest") },
    { date: ago(6), op: "ADD", target: "tasks/t_kale", after: { title: "Check kale undersides for aphids", due: due(1), priority: "med", reason: "aphids reported 2mi away" }, reason: "Early detection" },
    { date: ago(4), op: "ADD", target: "tasks/t_thin", after: { title: "Thin carrot seedlings, bed 4", due: due(2), priority: "low", reason: "crowded second sowing" }, reason: "Spacing for root size" },
    { date: ago(3), op: "ADD", target: "tasks/t_tomato", after: { title: "Pick ripe tomatoes, bed 6", due: due(0), priority: "med", reason: "fruit splitting after rain" }, reason: "Rain + ripe fruit = splits", obs: nimble("Rain 14 mm overnight", "forecast") },
    { date: ago(2), op: "ADD", target: "tasks/t_peppers", after: { title: "Transplant pepper starts into bed 5", due: due(0), priority: "high", reason: "bed 5 prepped; starts hardened off" }, reason: "Starts ready", obs: user("Pepper starts hardened off, ready to go out") },
  ];
  return [...fixed.filter((e) => e.date < ago(26)), ...recent];
}

function weather(date: Date, r: () => number, wetSpring: boolean) {
  const doy = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
  const base = 14 - 12 * Math.cos(((doy - 20) / 365) * 2 * Math.PI);
  const high = Math.round(base + 5 + r() * 6);
  const low = Math.round(base - 5 + r() * 4);
  const wet = wetSpring && doy < 150 ? 0.6 : 0.3;
  const rain = r() < wet ? Math.round(r() * 18) : 0;
  return { text: `Forecast: high ${high}°C / low ${low}°C${rain ? `, rain ${rain} mm` : ", dry"}`, high, low, rain_mm: rain };
}

export function buildSeed(now: Date) {
  const r = rng(20240301);
  const y = now.getUTCFullYear();
  const seasons = [
    { start: at(y - 1, "03-01"), end: at(y - 1, "10-31"), events: lastSeason(y - 1), wet: false },
    { start: at(y, "03-01"), end: addDays(now, -1), events: currentSeason(y, now), wet: true },
  ];

  const observations: Observation[] = [];
  const plan_versions: PlanVersion[] = [];
  const plan_edits: PlanEdit[] = [];
  const loops: LoopRun[] = [];
  let plan = emptyPlan();
  let loop = 0;
  let version = 1;
  plan_versions.push({ version, ts: seasons[0].start.toISOString(), loop: 0, plan });

  for (const season of seasons) {
    const events = [...season.events].sort((a, b) => +a.date - +b.date);
    for (let day = season.start; day <= season.end; day = addDays(day, 1)) {
      loop++;
      const ts = new Date(day);
      ts.setUTCHours(7, 0, 0, 0);
      const obsToday: Observation[] = [
        { ts: ts.toISOString(), source: "nimble", kind: "forecast", content: weather(day, r, season.wet), loop },
      ];
      if (r() < 0.55)
        obsToday.push({
          ts: new Date(+ts + 36e5).toISOString(),
          source: "nimble",
          kind: "soil",
          content: { text: `Soil moisture: ${Math.round(20 + r() * 25)}% avg across beds` },
          loop,
        });
      const todays = events.filter((e) => isoDay(e.date) === isoDay(day));
      const edits: PlanEdit[] = [];
      for (const e of todays) {
        const ets = new Date(+ts + 2 * 36e5).toISOString();
        if (e.obs) obsToday.push({ ts: ets, source: e.obs.source, kind: e.obs.kind, content: { text: e.obs.text }, loop });
        const [coll, id] = e.target.split("/");
        const before =
          e.before ??
          (id ? ((plan as unknown as Record<string, { id: string }[]>)[coll]?.find((x) => x.id === id) ?? null) : null);
        const edit: PlanEdit = { ts: ets, loop, op: e.op, target: e.target, before, after: e.after ?? null, reason: e.reason, evidence: e.obs?.text };
        plan = applyEdit(plan, edit);
        edits.push(edit);
      }
      observations.push(...obsToday);
      plan_edits.push(...edits);
      if (edits.length) plan_versions.push({ version: ++version, ts: new Date(+ts + 3 * 36e5).toISOString(), loop, plan });
      loops.push({
        loop,
        ts: ts.toISOString(),
        duration_s: Math.round((1.2 + r() * 2.5) * 10) / 10,
        obs_count: obsToday.length,
        edits_count: edits.length,
        plan_words: planWords(plan),
      });
    }
  }

  const qa_log: QA[] = [
    {
      ts: addDays(now, -9).toISOString(),
      question: "When should I sow fall spinach?",
      answer: "Now-ish — bed 1 is free after the beans, and last year's spinach did best sown early and cool.",
      plan_version: version,
    },
  ];
  return { observations, plan_versions, plan_edits, qa_log, loops };
}
