# Perennial — The Garden That Remembers 🌱

> A long-horizon gardening agent with explicit, mutable memory.
> Built in 4 hours for the agent-memory hackathon.

## The problem

Every agent that runs for months faces the same death: it drowns in its own history. Observations pile up, context windows bloat, costs climb, and the agent gets *less* reliable the longer it lives.

Gardeners know this problem intimately. A garden is a multi-year, multi-threaded project — dozens of plantings, weather events, pests, soil history — and the "memory" is usually a notebook, a spreadsheet, and seed packets with scribbles. Ask what happened two seasons ago and you get a shrug.

## The idea

**Perennial** is a gardening agent whose entire working memory is a small, explicit, mutable plan — not an ever-growing transcript. It logs plantings, watches the weather and pest pressure, and *rewrites its own plan* as the world changes: shifting dates, retiring stale advice, promoting what actually worked. Everything is stored; only what matters stays live.

*Your garden has a memory now. It just needed a better one than yours.*

## How it works

```
  ┌─────────┐      ┌──────────┐     ┌───────────┐     ┌──────────┐
  │  You log │───▶│  Nimble  │────▶│ Liquid AI │────▶│ RawTree  │
  │ planting │     │  watches │     │  rewrites │      │  keeps   │
  │ /harvest │     │  world   │     │  the plan │      │  history │
  └─────────┘      └──────────┘     └───────────┘     └──────────┘
                        │                 │                  │
                   weather, frost,   KEEP / UPDATE /      versioned,
                   pests, varieties  RETIRE / ADD         queryable
```

**One loop, every few minutes (or on demand):**
1. **Nimble** pulls fresh external observations: local forecast, frost risk, regional pest/disease alerts, variety notes.
2. Raw observations are appended to RawTree (`observations`).
3. **Liquid AI** receives the *current plan* (small, bounded), the new observations, and a strict JSON schema. It returns plan edits — never prose.
4. Edits are applied, each logged with a reason (`plan_edits`). The plan stays small; history stays complete.
5. The UI re-renders from the current plan. "Ask the garden" answers from current state only.

**The persist/discard boundary** — the whole point:
- **Persists:** variety performance per bed across years, soil history, what actually worked, open threats, upcoming tasks.
- **Discarded (compressed):** last week's weather → "wet spring"; resolved pest scares; superseded sowing dates. The archive keeps everything; the working mind stays lean.

## Sponsor tools

| Tool | Role |
|---|---|
| **Nimble** | Fresh, trusted external observations — weather, frost dates, pest/disease alerts, variety data. The world, delivered. |
| **Liquid AI** | The cheap, frequent "head gardener" — triages every observation into structured plan edits. Small model, strict JSON, high cadence. |
| **RawTree** | The ground truth — append-only log of observations, plan versions, edits with reasons, Q&A history. Schemaless ingestion, SQL-queryable. |

## Repo structure

```
perennial/
├── README.md                 # you are here
├── PDD.md                    # product design document
├── .env.example              # LIQUID_API_KEY, NIMBLE_API_KEY, RAWTREE_*
├── loop/
│   ├── main.py               # the autonomous loop
│   ├── nimble_adapter.py     # weather / pest / variety observations
│   ├── gardener.py           # Liquid AI plan-rewrite calls + JSON validation
│   └── rawtree_store.py      # append/query helpers (rtree CLI)
├── seed/
│   └── demo_garden.py        # seeds 2 seasons of history for the demo
├── ui/
│   └── index.html            # the garden: bed map, this week, threat watch,
│                             # ask-the-garden, season timeline
└── mockups/
    └── plot-plan-ui.webp     # design reference
```

## Quickstart

```bash
cp .env.example .env        # fill in LIQUID_API_KEY, NIMBLE_API_KEY, rtree login
rtree login
python seed/demo_garden.py  # 2 seasons of history in ~60 seconds
python loop/main.py         # start the autonomous loop
open ui/index.html          # watch the garden think
```

## Why it wins

| Criterion | How Perennial scores |
|---|---|
| **Autonomy** | The loop runs itself: observe → rewrite → log. No human in the loop. |
| **Idea** | Real, serious, universal — every gardener's actual pain, with retention built into the season cycle. |
| **Technical** | Explicit mutable state with a real persist/discard boundary, versioned in RawTree, editable by Liquid AI. |
| **Tool use** | All three sponsors load-bearing: Nimble sees, Liquid AI thinks, RawTree remembers. Remove one and it breaks. |
| **Presentation** | A UI judges remember — a living garden, not another dashboard. |

## Roadmap (beyond the hackathon)

- Photo diagnosis: snap a sad leaf, get a diagnosis folded into the plan
- Community blight network: anonymized regional pest pressure
- Harvest predictions from your own historical yields
- Perennial Premium: multi-garden, family sharing, print your season book
