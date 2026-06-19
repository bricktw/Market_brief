// ---------------------------------------------------------------------------
// Forex Factory economic calendar — current-week feed, free, no auth.
//
// Endpoint: https://nfs.faireconomy.media/ff_calendar_thisweek.json
// (The same feed Forex Factory's own client uses; published by Fair Economy /
// `nfs.faireconomy.media` for embedding. No API key, no rate limit.)
//
// Switched in 2026-06-19 after Finnhub gated /calendar/economic behind a paid
// SKU. Same impact enum ("Low" | "Medium" | "High") → existing
// filterEconomic3Star() works unchanged once we shim the rows into
// EconomicItem shape.
//
// Schema notes:
//   - `country` is a currency code (USD/GBP/...) rather than an ISO country
//     code; we map it to a short country label (US/GB/...). "All" stays as "—".
//   - `forecast` / `previous` are display strings ("62K", "1.2%", "<1.00%") —
//     we preserve them verbatim in `estimateText` / `prevText` (new optional
//     fields on EconomicItem) so the renderer can show units. The numeric
//     `estimate` / `prev` are best-effort parsed for any future numeric use.
//   - `impact: "Holiday"` rows are dropped at fetch time — they aren't
//     releases, just market-closure markers.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { EconomicItem } from "./finnhub.ts";

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

const FFItemSchema = z
  .object({
    title: z.string(),
    country: z.string(),
    date: z.string(),
    impact: z.string(),
    forecast: z.string().nullable().optional().default(""),
    previous: z.string().nullable().optional().default(""),
  })
  .passthrough();

const FFResponseSchema = z.array(FFItemSchema);

/** Currency-code → short country label for the rendered table. */
const COUNTRY_MAP: Record<string, string> = {
  USD: "US",
  GBP: "GB",
  EUR: "EU",
  JPY: "JP",
  CNY: "CN",
  CAD: "CA",
  AUD: "AU",
  NZD: "NZ",
  CHF: "CH",
  All: "—",
};

/** Best-effort numeric parse: "62K"→62000, "1.2%"→1.2, "<1.00%"→1, ""→null. */
function parseFfNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[<>%,$]/g, "").trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*([KMB])?$/i.exec(cleaned);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  switch ((m[2] ?? "").toUpperCase()) {
    case "K": return n * 1_000;
    case "M": return n * 1_000_000;
    case "B": return n * 1_000_000_000;
    default:  return n;
  }
}

/**
 * Fetch the Forex Factory current-week calendar and return rows shimmed into
 * the EconomicItem shape so the rest of the pipeline doesn't change.
 * Never throws — logs and returns [] on any failure.
 */
export async function fetchForexFactoryCalendar(): Promise<EconomicItem[]> {
  try {
    const res = await fetch(FF_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      console.warn(`[forexfactory] HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    const json: unknown = await res.json();
    const parsed = FFResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        `[forexfactory] schema drift, skipping: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      return [];
    }
    return parsed.data
      .filter((it) => it.impact !== "Holiday")
      .map<EconomicItem>((it) => ({
        time: it.date,
        country: COUNTRY_MAP[it.country] ?? it.country,
        event: it.title,
        impact: it.impact.toLowerCase(),
        estimate: parseFfNumber(it.forecast),
        prev: parseFfNumber(it.previous),
        estimateText: it.forecast ?? "",
        prevText: it.previous ?? "",
        unit: "",
      }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[forexfactory] fetch failed, skipping: ${msg}`);
    return [];
  }
}
