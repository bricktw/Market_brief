// ---------------------------------------------------------------------------
// Static lookup tables consumed by the renderer:
//   - translateEvent()    : Finnhub economic event name → zh-Hant
//   - lookupCompanyName() : S&P 500 tech ticker → company name
//
// Both are exact-match. Unmatched keys return undefined so the renderer can
// gracefully fall back (English-only event label, ticker-only earnings row).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../../data");

let eventMap: Map<string, string> | null = null;
let companyMap: Map<string, string> | null = null;

function loadJsonMap(file: string): Map<string, string> {
  const raw = readFileSync(resolve(dataDir, file), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string") m.set(k, v);
  }
  return m;
}

export function translateEvent(en: string): string | undefined {
  if (!eventMap) eventMap = loadJsonMap("econ_event_zh.json");
  return eventMap.get(en);
}

export function lookupCompanyName(symbol: string): string | undefined {
  if (!companyMap) companyMap = loadJsonMap("sp500_tech_names.json");
  return companyMap.get(symbol);
}

export function yahooQuoteUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}
