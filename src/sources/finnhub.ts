import { z } from "zod";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

const EarningsItemSchema = z.object({
  date: z.string(),
  symbol: z.string(),
  hour: z.string().optional().default(""),
  epsActual: z.number().nullable().optional(),
  epsEstimate: z.number().nullable().optional(),
  revenueActual: z.number().nullable().optional(),
  revenueEstimate: z.number().nullable().optional(),
  year: z.number().optional(),
  quarter: z.number().optional(),
});

const EarningsResponseSchema = z.object({
  earningsCalendar: z.array(EarningsItemSchema).nullable().default([]),
});

export type EarningsItem = z.infer<typeof EarningsItemSchema>;

export interface DateRange {
  from: string;
  to: string;
}

/** @deprecated alias kept for M1 callers; use DateRange. */
export type EarningsRange = DateRange;

function requireApiKey(): string {
  const key = process.env["FINNHUB_API_KEY"];
  if (!key) {
    throw new Error(
      "FINNHUB_API_KEY is not set. Copy .env.example to .env and fill in your key.",
    );
  }
  return key;
}

/**
 * Shared fetch + Zod-validate helper. Same error-handling contract as the
 * original fetchEarningsCalendar: throw on non-2xx, throw on schema drift.
 */
async function finnhubGet<S extends z.ZodTypeAny>(
  path: string,
  params: Record<string, string>,
  schema: S,
): Promise<z.infer<S>> {
  const token = requireApiKey();
  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("token", token);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Finnhub ${path} ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }

  const json: unknown = await res.json();
  return schema.parse(json) as z.infer<S>;
}

export async function fetchEarningsCalendar(
  range: DateRange,
): Promise<EarningsItem[]> {
  const token = requireApiKey();
  const url = new URL(`${FINNHUB_BASE}/calendar/earnings`);
  url.searchParams.set("from", range.from);
  url.searchParams.set("to", range.to);
  url.searchParams.set("token", token);

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Finnhub /calendar/earnings ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }

  const json: unknown = await res.json();
  const parsed = EarningsResponseSchema.parse(json);
  return parsed.earningsCalendar ?? [];
}

// ---------------------------------------------------------------------------
// IPO calendar — GET /calendar/ipo
// Observed shape: { ipoCalendar: [{ date, exchange, name, numberOfShares,
//                  price, status, symbol, totalSharesValue }] }
// `price` arrives as a string ("18.00"); several fields nullable for filings.
// ---------------------------------------------------------------------------

const IpoItemSchema = z.object({
  date: z.string(),
  symbol: z.string(),
  name: z.string().nullable().optional().default(""),
  exchange: z.string().nullable().optional(),
  numberOfShares: z.number().nullable().optional(),
  price: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  totalSharesValue: z.number().nullable().optional(),
});

const IpoResponseSchema = z.object({
  ipoCalendar: z.array(IpoItemSchema).nullable().default([]),
});

export type IpoItem = z.infer<typeof IpoItemSchema>;

export async function fetchIpoCalendar(range: DateRange): Promise<IpoItem[]> {
  const parsed = await finnhubGet(
    "/calendar/ipo",
    { from: range.from, to: range.to },
    IpoResponseSchema,
  );
  return parsed.ipoCalendar ?? [];
}

// ---------------------------------------------------------------------------
// Economic calendar — GET /calendar/economic
// Observed shape: { economicCalendar: [{ actual, country, estimate, event,
//                  impact, prev, time, unit }] }
// `impact` is a STRING enum "low"|"medium"|"high" (no numeric importance on
// the free tier). Schema stays defensive: also accept a numeric impact or a
// separate `importance` number in case the payload drifts. Calendar is global
// (EU/JP/KR/US/...), not US-only — caller decides any country narrowing.
// ---------------------------------------------------------------------------

const EconomicItemSchema = z.object({
  time: z.string(),
  country: z.string().nullable().optional().default(""),
  event: z.string(),
  impact: z.union([z.string(), z.number()]).nullable().optional(),
  importance: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  estimate: z.number().nullable().optional(),
  prev: z.number().nullable().optional(),
  // Display-string forms populated by Forex Factory (preserves "62K", "1.2%",
  // "<1.00%" — Finnhub-sourced rows leave these undefined). Renderer prefers
  // these when present, else falls back to fmtNum(estimate)/fmtNum(prev).
  estimateText: z.string().nullable().optional(),
  prevText: z.string().nullable().optional(),
  unit: z.string().nullable().optional().default(""),
});

const EconomicResponseSchema = z.object({
  economicCalendar: z.array(EconomicItemSchema).nullable().default([]),
});

export type EconomicItem = z.infer<typeof EconomicItemSchema>;

export async function fetchEconomicCalendar(
  range: DateRange,
): Promise<EconomicItem[]> {
  const parsed = await finnhubGet(
    "/calendar/economic",
    { from: range.from, to: range.to },
    EconomicResponseSchema,
  );
  return parsed.economicCalendar ?? [];
}

// ---------------------------------------------------------------------------
// Market news — GET /news?category=...
// Observed shape: top-level array of { category, datetime (unix s), headline,
//                  id, image, related (comma tickers, often ""), source,
//                  summary, url }. NOTE: this endpoint is a *latest feed* with
// no from/to support — it returns current news, not news for an arbitrary
// past date. Correct for same-day briefs; documented limitation otherwise.
// ---------------------------------------------------------------------------

const NewsItemSchema = z.object({
  id: z.number(),
  datetime: z.number(),
  headline: z.string(),
  source: z.string().nullable().optional().default(""),
  summary: z.string().nullable().optional().default(""),
  url: z.string().nullable().optional().default(""),
  category: z.string().nullable().optional().default(""),
  related: z.string().nullable().optional().default(""),
  image: z.string().nullable().optional().default(""),
});

const NewsResponseSchema = z.array(NewsItemSchema);

export type NewsItem = z.infer<typeof NewsItemSchema>;

/**
 * Fetch general + forex market news and merge, de-duplicated by id.
 * The endpoint ignores date params, so this is the latest feed.
 */
export async function fetchNews(): Promise<NewsItem[]> {
  const [general, forex] = await Promise.all([
    finnhubGet("/news", { category: "general" }, NewsResponseSchema),
    finnhubGet("/news", { category: "forex" }, NewsResponseSchema),
  ]);
  const byId = new Map<number, NewsItem>();
  for (const item of [...general, ...forex]) byId.set(item.id, item);
  return [...byId.values()];
}
