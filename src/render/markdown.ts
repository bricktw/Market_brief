// ---------------------------------------------------------------------------
// Bilingual brief renderer (zh + en in a single page).
//
// Layout decision per CLAUDE.md M4 ("start with single-page bilingual sections
// (zh block then en block), defer i18n routing"): each section header carries
// both languages ("中文 / English"), with a short bilingual descriptor inside
// when degraded. Jin10 content stays in zh (zh-native source), Finnhub content
// stays in en. We do not attempt to translate item bodies.
// ---------------------------------------------------------------------------

import { formatInTimeZone } from "date-fns-tz";
import type {
  EarningsItem,
  EconomicItem,
  IpoItem,
} from "../sources/finnhub.ts";
import { economicStars, type ScoredNews } from "../filter/strict.ts";
import {
  flashStars,
  type Jin10FlashItem,
} from "../sources/jin10.ts";
import {
  lookupCompanyName,
  translateEvent,
  yahooQuoteUrl,
} from "./i18n.ts";
import { renderFrontmatter, type Session } from "./frontmatter.ts";

export type { Session } from "./frontmatter.ts";

export interface BriefData {
  date: string;                       // YYYY-MM-DD (ET, the US session focus)
  session: Session;
  econ3Star: EconomicItem[];
  earningsSp500Tech: EarningsItem[];
  earningsTotal: number;
  earningsTw0050: EarningsItem[];
  iposUsWeek: IpoItem[];              // US-listed only, [date, date+6]
  ipoWindowTo: string;                // YYYY-MM-DD, end of the week window
  topNews: ScoredNews[];
  flashNews: Jin10FlashItem[];        // pre-filtered: type=0, has content, important===1
  flashEcon3Star: Jin10FlashItem[];   // pre-filtered: type=1, star>=3
  generatedAt: string;                // ISO
}

const ET_TZ = "America/New_York";
const TW_TZ = "Asia/Taipei";

const SESSION_TITLES: Record<Session, { zh: string; en: string }> = {
  morning: { zh: "早報", en: "Morning Brief" },
  evening: { zh: "晚報", en: "Evening Brief" },
};

// --- small helpers ---------------------------------------------------------

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

function formatHour(hour: string | undefined): string {
  switch (hour) {
    case "bmo": return "BMO";
    case "amc": return "AMC";
    case "dmh": return "DMH";
    case "":
    case undefined: return "—";
    default: return hour;
  }
}

/** Markdown table-cell-safe: escape `|` and flatten newlines. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  return n == null ? "—" : n.toFixed(digits);
}

function fmtRev(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

// --- sections --------------------------------------------------------------

function eventBilingual(en: string): string {
  const zh = translateEvent(en);
  return zh ? `${zh} / ${en}` : en;
}

/** Prefer the display string (preserves "62K", "1.2%") when present. */
function fmtEconField(text: string | null | undefined, num: number | null | undefined): string {
  if (text && text.trim() !== "") return cell(text);
  return fmtNum(num);
}

function renderEconomic(d: BriefData): string {
  const lines = ["## 經濟事件 ≥ 3★ / Economic calendar ≥ 3★"];
  if (d.econ3Star.length === 0) {
    lines.push("", "_今日無高度重要事件 · No high-impact events today._");
    return lines.join("\n");
  }
  const rows = d.econ3Star.map((it) => [
    cell(it.time ?? "—"),
    cell(it.country ?? "—"),
    "★".repeat(economicStars(it)),
    cell(eventBilingual(it.event ?? "")),
    fmtEconField(it.estimateText, it.estimate),
    fmtEconField(it.prevText, it.prev),
  ]);
  lines.push(
    "",
    table(
      ["Time (ET)", "Country", "Impact", "Event 事件", "Est", "Prev"],
      rows,
    ),
  );
  return lines.join("\n");
}

function renderEarnings(d: BriefData): string {
  const lines = ["## 財報 / Earnings"];
  lines.push(
    "",
    `_S&P 500 tech basket: **${d.earningsSp500Tech.length}** of ${d.earningsTotal} total US earnings._`,
  );
  if (d.earningsSp500Tech.length > 0) {
    const rows = d.earningsSp500Tech.map((it) => {
      const name = lookupCompanyName(it.symbol) ?? "—";
      const symbolLink = `[\`${it.symbol}\`](${yahooQuoteUrl(it.symbol)})`;
      return [
        symbolLink,
        cell(name),
        formatHour(it.hour),
        fmtNum(it.epsEstimate),
        fmtRev(it.revenueEstimate),
      ];
    });
    lines.push(
      "",
      table(["Symbol", "Company 公司", "When", "EPS est", "Rev est"], rows),
    );
  }
  lines.push(
    "",
    `> TW0050: ${d.earningsTw0050.length} (Finnhub free tier is US-only — see CLAUDE.md)`,
  );
  return lines.join("\n");
}

function renderIpo(d: BriefData): string {
  const lines = [
    `## IPO 日曆 / IPO calendar — US, ${d.date} → ${d.ipoWindowTo}`,
  ];
  if (d.iposUsWeek.length === 0) {
    lines.push("", "_本週無 US IPO · No US IPOs this week._");
    return lines.join("\n");
  }
  const rows = d.iposUsWeek.map((it) => [
    `[\`${it.symbol}\`](${yahooQuoteUrl(it.symbol)})`,
    cell(it.date),
    it.price == null ? "—" : `$${it.price}`,
    cell(it.exchange ?? "—"),
    cell(it.status ?? "—"),
    cell(it.name ?? ""),
  ]);
  lines.push(
    "",
    table(["Symbol", "Date", "Price", "Exchange", "Status", "Name"], rows),
  );
  return lines.join("\n");
}

function renderNews(d: BriefData): string {
  const lines = ["## 重點新聞 / Top news"];
  if (d.topNews.length === 0) {
    lines.push("", "_No news available._");
    return lines.join("\n");
  }
  lines.push("");
  d.topNews.forEach(({ item, score }, i) => {
    const when = formatInTimeZone(
      new Date(item.datetime * 1000),
      ET_TZ,
      "MM-dd HH:mm",
    );
    const headline = item.url
      ? `[${item.headline}](${item.url})`
      : item.headline;
    lines.push(`${i + 1}. **[${score}]** ${headline}`);
    lines.push(`   _— ${item.source ?? ""} · ${when} ET_`);
  });
  return lines.join("\n");
}

function renderFlashNews(d: BriefData): string {
  // Suppress entirely when empty. Matches the flash-econ section. After the
  // important===1 filter, a quiet snapshot can legitimately have zero items
  // even though the feed worked — better to omit than to show a misleading
  // "stream unavailable" message.
  if (d.flashNews.length === 0) return "";
  const lines = ["## 金十快訊 / Jin10 macro flash", ""];
  for (const it of d.flashNews.slice(0, 15)) {
    const mark = it.important ? "★" : "·";
    const title = it.data.title ? `**【${it.data.title}】** ` : "";
    const body = stripHtml(it.data.content ?? "").slice(0, 280);
    lines.push(`- \`${it.time}\` ${mark} ${title}${body}`);
  }
  return lines.join("\n");
}

function renderFlashEcon(d: BriefData): string {
  // Suppress entirely when empty — flash type=1 items are sparse outside live
  // release windows, and the placeholder added noise per user feedback.
  if (d.flashEcon3Star.length === 0) return "";
  const lines = ["## 金十經濟發布 ≥ 3★ / Jin10 economic releases ≥ 3★"];
  const rows = d.flashEcon3Star.map((it) => {
    const dat = it.data;
    return [
      cell(it.time),
      cell(dat.country ?? "—"),
      "★".repeat(flashStars(it)),
      cell(dat.name ?? ""),
      cell(String(dat.actual ?? "—")),
      cell(String(dat.consensus ?? "—")),
      cell(String(dat.previous ?? "—")),
    ];
  });
  lines.push(
    "",
    table(
      ["Time", "Country", "Impact", "Indicator", "Actual", "Est", "Prev"],
      rows,
    ),
  );
  return lines.join("\n");
}

// --- top-level -------------------------------------------------------------

export function renderBrief(d: BriefData): string {
  const t = SESSION_TITLES[d.session];
  const title = `${t.zh} / ${t.en} — ${d.date}`;
  const fm = renderFrontmatter({
    title,
    date: d.date,
    session: d.session,
    tags: [d.session],
    description: `Bilingual finance digest for ${d.date} (${d.session} TW run).`,
  });
  const tw = formatInTimeZone(
    new Date(d.generatedAt),
    TW_TZ,
    "yyyy-MM-dd HH:mm",
  );
  const header = [
    `# ${title}`,
    "",
    `> 自動產生 · 雙語摘要 · 資料來源: Jin10 + Finnhub · 產生時間 ${tw} TW`,
    `>`,
    `> Auto-generated bilingual digest. Sources: Jin10 (zh macro) + Finnhub (US earnings/IPO/news/economic). Generated ${tw} TW.`,
  ].join("\n");
  const body = [
    renderEconomic(d),
    renderEarnings(d),
    renderIpo(d),
    renderNews(d),
    renderFlashNews(d),
    renderFlashEcon(d),
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
  return `${fm}\n${header}\n\n${body}\n`;
}
