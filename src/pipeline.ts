// ---------------------------------------------------------------------------
// Orchestrates one brief run: fetch → filter → render → write.
//
// All upstream fetchers are wrapped in `safe()` so a single failing source
// degrades to "(section unavailable)" inside the markdown rather than aborting
// the run. Jin10 fetchers already never throw; the wrapper here is for
// uniformity and to catch any future strictness regressions.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  fetchEarningsCalendar,
  fetchEconomicCalendar,
  fetchIpoCalendar,
  fetchNews,
  type EarningsItem,
  type EconomicItem,
  type IpoItem,
  type NewsItem,
} from "./sources/finnhub.ts";
import {
  filterEarningsSp500Tech,
  filterEarningsTw0050,
  filterEconomic3Star,
  filterIposUs,
  rankTopNews,
} from "./filter/strict.ts";
import {
  fetchJin10Flash,
  flashStars,
  isFlashEconomic,
  isFlashNews,
  type Jin10FlashItem,
} from "./sources/jin10.ts";
import {
  renderBrief,
  type BriefData,
  type Session,
} from "./render/markdown.ts";

const here = dirname(fileURLToPath(import.meta.url));
const briefsDir = resolve(here, "../docs/briefs");

export interface RunPipelineOpts {
  date: string;
  session: Session;
  outDir?: string;
}

export interface RunPipelineResult {
  filePath: string;
  data: BriefData;
}

/** "2026-05-08" + 6 → "2026-05-14". Date-string arithmetic in UTC; safe across DST. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pipeline] ${label} unavailable: ${msg}`);
    return fallback;
  }
}

export async function runPipeline(
  opts: RunPipelineOpts,
): Promise<RunPipelineResult> {
  const { date, session } = opts;
  const outDir = opts.outDir ?? briefsDir;
  console.log(`[pipeline] building ${session} brief for ${date}`);

  const ipoTo = addDays(date, 6);

  const [econ, earnings, ipos, news, flash] = await Promise.all([
    safe<EconomicItem[]>(
      "economic",
      () => fetchEconomicCalendar({ from: date, to: date }),
      [],
    ),
    safe<EarningsItem[]>(
      "earnings",
      () => fetchEarningsCalendar({ from: date, to: date }),
      [],
    ),
    safe<IpoItem[]>(
      "ipo",
      () => fetchIpoCalendar({ from: date, to: ipoTo }),
      [],
    ),
    safe<NewsItem[]>("news", () => fetchNews(), []),
    safe<Jin10FlashItem[]>("jin10-flash", () => fetchJin10Flash(), []),
  ]);

  const data: BriefData = {
    date,
    session,
    econ3Star: filterEconomic3Star(econ),
    earningsSp500Tech: filterEarningsSp500Tech(earnings),
    earningsTotal: earnings.length,
    earningsTw0050: filterEarningsTw0050(earnings),
    iposUsWeek: filterIposUs(ipos),
    ipoWindowTo: ipoTo,
    topNews: rankTopNews(news),
    flashNews: flash
      .filter(isFlashNews)
      .filter((it) => it.data.content)
      .filter((it) => it.important === 1),
    flashEcon3Star: flash
      .filter(isFlashEconomic)
      .filter((it) => flashStars(it) >= 3),
    generatedAt: new Date().toISOString(),
  };

  const md = renderBrief(data);
  mkdirSync(outDir, { recursive: true });
  const filePath = resolve(outDir, `${date}-${session}.md`);
  writeFileSync(filePath, md, "utf8");
  console.log(`[pipeline] wrote ${filePath}`);
  return { filePath, data };
}
