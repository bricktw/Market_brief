import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  EarningsItem,
  EconomicItem,
  NewsItem,
} from "../sources/finnhub.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../../data");

const tickerSetCache = new Map<string, Set<string>>();

/** Load a `data/<file>` string[] of tickers into a cached Set. */
function loadTickerSet(file: string): Set<string> {
  const cached = tickerSetCache.get(file);
  if (cached) return cached;
  const raw = readFileSync(resolve(dataDir, file), "utf8");
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr) || !arr.every((t): t is string => typeof t === "string")) {
    throw new Error(`data/${file} must be a string[]`);
  }
  const set = new Set(arr);
  tickerSetCache.set(file, set);
  return set;
}

function loadSp500Tech(): Set<string> {
  return loadTickerSet("sp500_tech.json");
}

export function filterEarningsSp500Tech(items: EarningsItem[]): EarningsItem[] {
  const set = loadSp500Tech();
  return items.filter((it) => set.has(it.symbol));
}

/**
 * Filter earnings down to the Taiwan 0050 basket (data/tw0050.json).
 * NOTE: inert on Finnhub free tier — its earnings calendar is US-only, so this
 * yields [] today. Correct + ready if a TW-capable source is added later.
 * See data/tw0050.README.md and CLAUDE.md.
 */
export function filterEarningsTw0050(items: EarningsItem[]): EarningsItem[] {
  const set = loadTickerSet("tw0050.json");
  return items.filter((it) => set.has(it.symbol));
}

export function tw0050Size(): number {
  return loadTickerSet("tw0050.json").size;
}

export function sp500TechSize(): number {
  return loadSp500Tech().size;
}

// ---------------------------------------------------------------------------
// Economic calendar: keep only "3-star" (high-impact) events.
//
// Finnhub's free-tier economic calendar reports `impact` as a string enum
// "low" | "medium" | "high" (no numeric importance). We map that to a 1–3
// star scale and keep >= 3 (i.e. "high"). Defensive: if the payload ever
// drifts to a numeric `impact` or a separate numeric `importance`, those are
// honoured too (1–3 scale, or >=3 raw).
// ---------------------------------------------------------------------------

export function economicStars(item: EconomicItem): number {
  if (typeof item.importance === "number") {
    return Math.max(0, Math.min(3, Math.round(item.importance)));
  }
  const impact = item.impact;
  if (typeof impact === "number") {
    return Math.max(0, Math.min(3, Math.round(impact)));
  }
  switch (String(impact ?? "").toLowerCase()) {
    case "high":
    case "3":
      return 3;
    case "medium":
    case "2":
      return 2;
    case "low":
    case "1":
      return 1;
    default:
      return 0;
  }
}

export function filterEconomic3Star(items: EconomicItem[]): EconomicItem[] {
  return items.filter((it) => economicStars(it) >= 3);
}

// ---------------------------------------------------------------------------
// Top-5 news ranking heuristic.
//
// Decision (2026-05-18): Finnhub returns news chronologically with no
// importance signal. We score each item by:
//   (1) Source weight — reputable global wires/financial press rank highest,
//       mainstream business outlets mid, everything else baseline.
//   (2) Ticker-mention bonus — relevance to our tracked tech universe:
//         +3 if any tracked ticker appears in the structured `related` field
//            (Finnhub's own comma-separated tagging — high precision);
//         +2 if a tracked ticker (len >= 3, to avoid "A"/"ON"/"IT"-style
//            false positives) appears as a standalone word in the headline.
// Sorted by score desc, newer-first as the tie-breaker; top 5 returned.
// Deliberately simple/explainable, not ML — see CLAUDE.md notes.
// ---------------------------------------------------------------------------

const SOURCE_WEIGHTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/reuters|bloomberg|\bwsj\b|wall street journal|financial times|\bft\b|associated press|\bap\b|cnbc|barron|marketwatch|the economist/i, 5],
  [/yahoo|forbes|business insider|seeking alpha|forexlive|investing|the motley fool|benzinga/i, 2],
];

function sourceWeight(source: string): number {
  for (const [re, w] of SOURCE_WEIGHTS) if (re.test(source)) return w;
  return 1;
}

function tickerBonus(item: NewsItem, tickers: Set<string>): number {
  const related = (item.related ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (related.some((t) => tickers.has(t))) return 3;

  const headline = item.headline ?? "";
  for (const t of tickers) {
    if (t.length < 3) continue;
    const re = new RegExp(`\\b${t}\\b`);
    if (re.test(headline)) return 2;
  }
  return 0;
}

export interface ScoredNews {
  item: NewsItem;
  score: number;
}

export function rankTopNews(items: NewsItem[], limit = 5): ScoredNews[] {
  const tickers = loadSp500Tech();
  const scored = items.map((item) => ({
    item,
    score: sourceWeight(item.source ?? "") + tickerBonus(item, tickers),
  }));
  scored.sort(
    (a, b) => b.score - a.score || b.item.datetime - a.item.datetime,
  );
  return scored.slice(0, limit);
}
