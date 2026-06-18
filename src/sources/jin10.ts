import { z } from "zod";

// ---------------------------------------------------------------------------
// Jin10 sources. Endpoint paths are undocumented public infra and DRIFT — see
// CLAUDE.md "Jin10 endpoint drift" risk. Verified live 2026-05-18:
//
//  * FLASH (works): https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1
//    Requires browser-style headers incl. the public web client app id. Host
//    resolves to Aliyun CN (cn-hangzhou). Returns { status, message, data:[] }.
//    Items carry `type`: 0 = news/flash text, 1 = economic indicator release
//    (with `star` importance, star>=3 == high, matching Jin10's own UI logic),
//    2 = other. The flash stream therefore carries inline Asia macro releases.
//
//  * CALENDAR (currently UNREACHABLE): the rili web app hardcodes
//    https://cdn-rili.jin10.com/web_data/{year}/{week|month}/{n}/economics.json
//    but `cdn-rili.jin10.com` is NXDOMAIN from public DNS (default + 8.8.8.8) —
//    decommissioned or China-internal. Live daily calendar flows over a
//    socket.io WebSocket (out of scope). fetchJin10Calendar() targets the
//    documented path so it auto-recovers if the host ever revives, but today
//    it degrades cleanly (logs + returns []). Asia macro is covered in the
//    interim by (a) flash type=1 items here and (b) Finnhub's global economic
//    calendar (already includes JP/KR/CN — see M2 notes in CLAUDE.md).
//
// Both fetchers NEVER throw: on network or schema failure they log the section
// and return [] (M3 deliverable: "on parse failure, log section + skip cleanly").
// ---------------------------------------------------------------------------

const FLASH_URL =
  "https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  // Public Jin10 web-client identifiers (not a secret/paid key).
  "x-app-id": "bVBF4FyRTn5NJF5n",
  "x-version": "1.0.0",
};

const numish = z.union([z.string(), z.number()]).nullable().optional();

/** `data` shape varies by item `type`; keep permissive + passthrough. */
const FlashDataSchema = z
  .object({
    // type=0 — news / flash text
    content: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    pic: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    source_link: z.string().nullable().optional(),
    // type=1 — economic indicator release
    name: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    star: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    actual: numish,
    consensus: numish,
    previous: numish,
    revised: numish,
    time_period: z.string().nullable().optional(),
    pub_time: z.string().nullable().optional(),
    indicator_id: numish,
  })
  .passthrough();

const FlashItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    time: z.string(),
    type: z.number(),
    important: z.number().nullable().optional().default(0),
    data: FlashDataSchema,
  })
  .passthrough();

const FlashResponseSchema = z.object({
  status: z.number(),
  message: z.string().nullable().optional().default(""),
  data: z.array(FlashItemSchema).nullable().default([]),
});

export type Jin10FlashItem = z.infer<typeof FlashItemSchema>;

/** Item `type` codes observed in the flash stream. */
export const FLASH_TYPE_NEWS = 0;
export const FLASH_TYPE_ECONOMIC = 1;

export function isFlashNews(it: Jin10FlashItem): boolean {
  return it.type === FLASH_TYPE_NEWS;
}

export function isFlashEconomic(it: Jin10FlashItem): boolean {
  return it.type === FLASH_TYPE_ECONOMIC;
}

/** Jin10 importance star rating (0–5); >=3 is "high" per Jin10's own UI. */
export function flashStars(it: Jin10FlashItem): number {
  const s = it.data.star;
  return typeof s === "number" ? s : 0;
}

/**
 * Fetch the Jin10 macro flash stream. Never throws — logs + returns [] on any
 * failure so the pipeline degrades to "section unavailable".
 */
export async function fetchJin10Flash(): Promise<Jin10FlashItem[]> {
  try {
    const res = await fetch(FLASH_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      console.warn(
        `[jin10] flash unavailable: HTTP ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json: unknown = await res.json();
    const parsed = FlashResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        `[jin10] flash schema drift, skipping: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      return [];
    }
    if (parsed.data.status !== 200) {
      console.warn(
        `[jin10] flash status ${parsed.data.status}: ${parsed.data.message}`,
      );
      return [];
    }
    return parsed.data.data ?? [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[jin10] flash fetch failed, skipping: ${msg}`);
    return [];
  }
}

// --- Asia economic calendar (currently unreachable; degrades cleanly) -------

const CalendarItemSchema = z
  .object({
    id: numish,
    name: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    star: z.number().nullable().optional(),
    actual: numish,
    consensus: numish,
    previous: numish,
    revised: numish,
    unit: z.string().nullable().optional(),
    pub_time: z.string().nullable().optional(),
    event_time: z.string().nullable().optional(),
  })
  .passthrough();

// Observed wrappers vary; accept a bare array or a { data | list } envelope.
const CalendarResponseSchema = z.union([
  z.array(CalendarItemSchema),
  z.object({ data: z.array(CalendarItemSchema).nullable().default([]) }),
  z.object({ list: z.array(CalendarItemSchema).nullable().default([]) }),
]);

export type Jin10CalendarItem = z.infer<typeof CalendarItemSchema>;

function isoWeek(date: Date): { year: number; week: number } {
  // ISO-8601 week (Mon-based), matching the rili bundle's /web_data/{y}/week/{w}/.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return { year: d.getUTCFullYear(), week };
}

/**
 * Fetch the Jin10 Asia economic calendar for the ISO week containing `date`.
 * Targets the path the rili web app uses. The host is currently NXDOMAIN, so
 * in practice this logs once and returns [] — by design, no throw. It will
 * start working automatically if Jin10 restores the host.
 */
export async function fetchJin10Calendar(
  date: Date = new Date(),
): Promise<Jin10CalendarItem[]> {
  const { year, week } = isoWeek(date);
  const url = `https://cdn-rili.jin10.com/web_data/${year}/week/${week}/economics.json`;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      console.warn(
        `[jin10] calendar unavailable: HTTP ${res.status} (${url})`,
      );
      return [];
    }
    const json: unknown = await res.json();
    const parsed = CalendarResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`[jin10] calendar schema drift, skipping`);
      return [];
    }
    return Array.isArray(parsed.data)
      ? parsed.data
      : ((parsed.data as { data?: Jin10CalendarItem[]; list?: Jin10CalendarItem[] }).data ??
          (parsed.data as { list?: Jin10CalendarItem[] }).list ??
          []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[jin10] calendar host unreachable (expected — cdn-rili.jin10.com is ` +
        `NXDOMAIN as of 2026-05-18), skipping: ${msg}`,
    );
    return [];
  }
}
