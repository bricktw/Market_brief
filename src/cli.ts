import "dotenv/config";
import { formatInTimeZone } from "date-fns-tz";
import {
  fetchEarningsCalendar,
  fetchEconomicCalendar,
  fetchIpoCalendar,
  fetchNews,
  type EarningsItem,
  type EconomicItem,
  type IpoItem,
} from "./sources/finnhub.ts";
import {
  filterEarningsSp500Tech,
  filterEarningsTw0050,
  filterEconomic3Star,
  economicStars,
  rankTopNews,
  type ScoredNews,
} from "./filter/strict.ts";
import {
  fetchJin10Flash,
  fetchJin10Calendar,
  isFlashNews,
  isFlashEconomic,
  flashStars,
  type Jin10FlashItem,
} from "./sources/jin10.ts";
import { runPipeline } from "./pipeline.ts";
import type { Session } from "./render/markdown.ts";

const ET_TZ = "America/New_York";

function todayET(now: Date = new Date()): string {
  return formatInTimeZone(now, ET_TZ, "yyyy-MM-dd");
}

function tomorrowET(now: Date = new Date()): string {
  const today = todayET(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return formatInTimeZone(next, ET_TZ, "yyyy-MM-dd");
}

/**
 * Default ET date for a session:
 *  - morning (07:30 TW ≈ prior-day ET evening): brief the *upcoming* US session = tomorrow ET
 *  - evening (20:00 TW ≈ same-day ET morning): brief the about-to-open US session = today ET
 * Without a session, fall back to tomorrow ET (preserves M1–M3 debug behavior).
 */
function defaultDateForSession(session: Session | null): string {
  return session === "evening" ? todayET() : tomorrowET();
}

function parseSessionArg(): Session | null {
  const arg = process.argv.find((a) => a.startsWith("--session="));
  if (!arg) return null;
  const value = arg.slice("--session=".length);
  if (value !== "morning" && value !== "evening") {
    throw new Error(
      `Invalid --session (expected "morning" or "evening"): ${value}`,
    );
  }
  return value;
}

function parseDateArg(session: Session | null): string {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (!arg) return defaultDateForSession(session);
  const value = arg.slice("--date=".length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value (expected YYYY-MM-DD): ${value}`);
  }
  return value;
}

function formatHour(hour: string | undefined): string {
  switch (hour) {
    case "bmo":
      return "BMO";
    case "amc":
      return "AMC";
    case "dmh":
      return "DMH";
    case "":
    case undefined:
      return "—";
    default:
      return hour;
  }
}

/** Run a section; on failure print a degraded notice instead of crashing. */
async function section(title: string, body: () => Promise<void>): Promise<void> {
  console.log("");
  console.log(`# ${title}`);
  try {
    await body();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`(section unavailable: ${msg})`);
  }
}

function printEconomic(items: EconomicItem[]): void {
  console.log(`3★ events: ${items.length}`);
  if (items.length === 0) return;
  console.log("");
  for (const it of items) {
    const stars = "★".repeat(economicStars(it));
    const country = (it.country ?? "").padEnd(3);
    console.log(`${it.time}  ${country}  ${stars}  ${it.event}`);
  }
}

function printEarnings(items: EarningsItem[], total: number): void {
  console.log(`S&P 500 tech: ${items.length} of ${total} total`);
  if (items.length === 0) return;
  console.log("");
  console.log("Symbol    When   EPS est    Rev est");
  console.log("------    ----   --------   --------");
  for (const it of items) {
    const sym = it.symbol.padEnd(8);
    const when = formatHour(it.hour).padEnd(6);
    const eps = it.epsEstimate == null ? "—" : it.epsEstimate.toFixed(2);
    const rev =
      it.revenueEstimate == null
        ? "—"
        : `$${(it.revenueEstimate / 1_000_000).toFixed(1)}M`;
    console.log(`${sym}  ${when}  ${eps.padStart(8)}   ${rev.padStart(8)}`);
  }
}

function printIpo(items: IpoItem[]): void {
  console.log(`IPOs: ${items.length}`);
  if (items.length === 0) return;
  console.log("");
  console.log("Symbol    Date         Price    Status     Name");
  console.log("------    ----------   ------   --------   ----");
  for (const it of items) {
    const sym = it.symbol.padEnd(8);
    const date = it.date.padEnd(10);
    const price = (it.price == null ? "—" : `$${it.price}`).padStart(6);
    const status = (it.status ?? "—").padEnd(8);
    console.log(`${sym}  ${date}   ${price}   ${status}   ${it.name ?? ""}`);
  }
}

function printNews(ranked: ScoredNews[]): void {
  console.log(`Top ${ranked.length} (by source weight + ticker relevance):`);
  if (ranked.length === 0) return;
  console.log("");
  ranked.forEach(({ item, score }, i) => {
    const when = formatInTimeZone(
      new Date(item.datetime * 1000),
      ET_TZ,
      "MM-dd HH:mm",
    );
    console.log(
      `${i + 1}. [${score}] ${item.headline}`,
    );
    console.log(`   — ${item.source} · ${when} ET`);
  });
}

/** Strip HTML tags + decode the few entities Jin10 emits; collapse space. */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function flashText(it: Jin10FlashItem): string {
  const d = it.data;
  const title = d.title ? `【${d.title}】` : "";
  const body = stripHtml(d.content ?? "");
  return `${title}${body}`;
}

function printFlashNews(items: Jin10FlashItem[]): void {
  const news = items.filter(isFlashNews).filter((it) => it.data.content);
  console.log(`Jin10 flash items: ${news.length}`);
  if (news.length === 0) return;
  console.log("");
  for (const it of news.slice(0, 10)) {
    const mark = it.important ? "★ " : "  ";
    const text = flashText(it);
    console.log(`${mark}${it.time}  ${text.slice(0, 140)}`);
  }
}

function printFlashEconomic(items: Jin10FlashItem[]): void {
  const econ = items
    .filter(isFlashEconomic)
    .filter((it) => flashStars(it) >= 3);
  console.log(`Jin10 economic releases ≥3★: ${econ.length}`);
  if (econ.length === 0) return;
  console.log("");
  for (const it of econ) {
    const stars = "★".repeat(flashStars(it));
    const d = it.data;
    const ctry = (d.country ?? "").padEnd(3);
    const act = d.actual ?? "—";
    const cons = d.consensus ?? "—";
    const prev = d.previous ?? "—";
    console.log(
      `${it.time}  ${ctry}  ${stars}  ${d.name ?? ""} ` +
        `(act ${act} / est ${cons} / prev ${prev})`,
    );
  }
}

async function main(): Promise<void> {
  const session = parseSessionArg();
  const date = parseDateArg(session);

  // `--session=...` switches from stdout debug mode to pipeline-write mode:
  // fetches every source, filters, renders bilingual markdown, writes to
  // docs/briefs/YYYY-MM-DD-{session}.md. Stdout mode (no --session) remains
  // the M1–M3 debug printer.
  if (session) {
    const { filePath } = await runPipeline({ date, session });
    console.log(`Brief written: ${filePath}`);
    return;
  }

  console.log(`Market Brief — target date ${date} (ET)`);

  await section(`Economic calendar ≥3★ — ${date}`, async () => {
    const all = await fetchEconomicCalendar({ from: date, to: date });
    printEconomic(filterEconomic3Star(all));
  });

  await section(`Earnings — ${date}`, async () => {
    const all = await fetchEarningsCalendar({ from: date, to: date });
    printEarnings(filterEarningsSp500Tech(all), all.length);
    const tw = filterEarningsTw0050(all);
    console.log(
      `TW0050: ${tw.length} (Finnhub free tier is US-only — see CLAUDE.md)`,
    );
  });

  await section(`IPO calendar — ${date}`, async () => {
    const all = await fetchIpoCalendar({ from: date, to: date });
    printIpo(all);
  });

  await section(`Top news (latest feed — endpoint is not date-filtered)`, async () => {
    const all = await fetchNews();
    printNews(rankTopNews(all));
  });

  // --- Jin10 (zh-native macro) ---------------------------------------------
  const flash = await fetchJin10Flash();

  await section(`Jin10 macro flash 金十快讯 (latest feed)`, async () => {
    printFlashNews(flash);
  });

  await section(`Jin10 economic releases ≥3★ (from flash stream)`, async () => {
    printFlashEconomic(flash);
  });

  await section(
    `Jin10 Asia economic calendar (cdn-rili host NXDOMAIN as of 2026-05-18)`,
    async () => {
      const cal = await fetchJin10Calendar(new Date(`${date}T00:00:00Z`));
      console.log(`Calendar items: ${cal.length}`);
    },
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
