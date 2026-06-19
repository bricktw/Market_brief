# Market_brief — daily bilingual finance digest, published to a hosted site

## Purpose

Pull market-moving finance signals (US + TW), produce a strict-filter bilingual digest twice per weekday, and publish it as a hosted static site so it's readable from anywhere. Sources: **Jin10** (Chinese-native macro flash + Asia economic calendar) + **Finnhub** (English earnings, IPO, US news, with BMO/AMC times). Replaces the original investing.com WebFetch plan after evaluating Cloudflare risk, BMO/AMC gaps, and Asia coverage.

## Scope

- **Size**: medium (~12–18 files, ~1–2 weeks solo)
- **Ceiling**: single deployable static site + cron pipeline; no backend service, no auth, no multi-user
- **In scope**: data fetch, filter, bilingual render, static-site publish, manual + scheduled triggers
- **Out of scope (this version)**: real-time streaming, push notifications, mobile app, paid Jin10 official API, full historical archive search/UI, ML-based importance scoring

## Tech Stack

- **Language**: TypeScript on Node.js 22 LTS — confidence: high — matches user choice; native `fetch` in Node 22
- **Static site**: VitePress — confidence: high — TS-first config, markdown input, GH Pages official support, built-in i18n for zh/en
- **HTTP**: native `fetch` — confidence: high — no extra dep
- **Schema validation**: Zod — confidence: medium — guards against Jin10 schema drift; alternative: hand-written type guards (lighter but less safe)
- **Date/time**: `date-fns-tz` — confidence: high — TW + UTC + ET conversion, lightweight vs. full Luxon
- **Env loading**: `dotenv` — confidence: high — standard
- **Package manager**: pnpm — confidence: medium — alternative npm (default) is fine; pnpm is faster on CI but not required
- **Hosting**: GitHub Pages — confidence: high — free, integrates with Actions cron
- **Scheduler**: GitHub Actions cron (primary) + Windows Task Scheduler (optional local fallback)
- **Manual trigger**: `/market-brief` slash command in Claude Code (local)

## Architecture

```
┌─ src/
│  ├─ sources/
│  │   ├─ finnhub.ts        # earnings, IPO, US news (econ went paid 2026-06-19)
│  │   ├─ forexfactory.ts   # weekly econ calendar (free, replaced Finnhub econ 2026-06-19)
│  │   └─ jin10.ts          # macro flash (live); Asia calendar (host dead, degrades)
│  ├─ filter/
│  │   └─ strict.ts         # 3-star econ events, S&P500 tech-basket earnings, top-5 news
│  ├─ render/
│  │   ├─ markdown.ts       # bilingual markdown (zh + en sections)
│  │   └─ frontmatter.ts    # VitePress page metadata
│  ├─ pipeline.ts           # orchestrate fetch → filter → render → write
│  └─ cli.ts                # entrypoint: `pnpm brief [--date=YYYY-MM-DD]`
├─ docs/                    # VitePress root
│  ├─ .vitepress/config.ts  # site config, sidebar auto-generated from briefs/
│  ├─ briefs/YYYY-MM-DD-{morning|evening}.md   # generated digests
│  └─ index.md              # landing page, latest brief + recent list
├─ .github/workflows/
│  ├─ scheduled-brief.yml   # cron 23:30 UTC + 12:00 UTC, Mon–Fri
│  └─ deploy-pages.yml      # build VitePress + publish on push to main
├─ .claude/commands/market-brief.md   # slash command spec
├─ .env                     # FINNHUB_API_KEY (gitignored)
├─ package.json
└─ tsconfig.json
```

**Data flow per run:**
- Resolve target window: morning run = previous US session close + today's TW pre-open; evening run = today's TW close + today's US pre-open
- Fetch in parallel: `finnhub.calendarEconomic` + `finnhub.calendarEarnings` + `finnhub.calendarIPO` + `finnhub.news` + `jin10.flash` + `jin10.calendar`
- Validate each response with Zod; on schema drift, log + degrade to "section unavailable"
- Apply strict filter: economic ≥ 3-star only, earnings ∈ S&P500 tech basket or TW0050, news = top 5 by importance
- Render bilingual markdown: section headers in both languages, Jin10 items kept in zh, Finnhub items in en, key macro events translated (titles only)
- Write `docs/briefs/YYYY-MM-DD-{morning|evening}.md`
- VitePress build picks it up; deploy workflow publishes to GH Pages

## Milestones

### M1 — Vertical slice: one source, runnable end-to-end (~1 day) — ✅ DONE 2026-05-17
- [x] Init Node + TypeScript project, `tsconfig.json` strict mode — **npm, not pnpm** (pnpm not installed on dev machine; CLAUDE.md flagged npm as acceptable fallback). Node 24 installed locally (engines still pins `>=22`).
- [x] `src/sources/finnhub.ts` — fetch `/calendar/earnings` for a date range, Zod-validated, return typed array
- [x] `src/cli.ts` — prints earnings to stdout; defaults to tomorrow ET, accepts `--date=YYYY-MM-DD`
- [x] Verify Finnhub API key flow via `.env` + `dotenv` — confirmed live (580 rows for 2026-05-07)

### M2 — Add remaining Finnhub sections + strict filter (~1 day) — ✅ DONE 2026-05-18
- [x] `finnhub.ts` adds `/calendar/ipo`, `/calendar/economic`, `/news` (category=general + forex, merged + de-duped). Shared `finnhubGet()` helper; same throw-on-error + Zod-validate contract as earnings.
- [x] `src/filter/strict.ts` — earnings (S&P500 tech basket), `filterEconomic3Star()` (impact==="high"), `rankTopNews()` (source weight + ticker-mention heuristic; see news-ranking decision below).
- [x] CLI prints all four filtered sections, each headed; per-section try/catch degrades to "(section unavailable)" instead of failing the whole run. Verified live: 2026-05-07 (8 tech earnings, 2 3★ econ, 3 IPOs, 5 news) and 2026-05-10 (all empty, no crash).

### M3 — Add Jin10 sources + Zod schemas (~1–2 days) — ✅ DONE 2026-05-18 (with documented gaps)
- [x] `src/sources/jin10.ts` — flash via **`https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1`** (NOT `open-data-api` — that's 502/paid) with browser headers + public web-client `x-app-id: bVBF4FyRTn5NJF5n` / `x-version: 1.0.0`. Calendar targets the rili web-app path `https://cdn-rili.jin10.com/web_data/{year}/week/{week}/economics.json` (NOT the `/daily/MM/DD/` path CLAUDE.md originally guessed) — but **`cdn-rili.jin10.com` is NXDOMAIN** (dead/China-internal; verified via default + 8.8.8.8). Calendar fetcher kept + degrades cleanly; auto-recovers if host revives. Flash fixture saved to `tests/fixtures/jin10-flash.json`.
- [x] Defensive Zod schemas (`.passthrough()`, permissive `data` per item `type`); `safeParse` → on any network/schema failure logs `[jin10] …` + returns `[]` (never throws).
- [x] `data/tw0050.json` (50 tickers, `{code}.TW`) + `filterEarningsTw0050()` in strict.ts. **Inert on Finnhub free tier** — earnings calendar is US-only (no `.TW`, no exchange suffixes; `?symbol=` & `/stock/profile2` are 403/premium). Per CLAUDE.md risk: accept gap, don't spike to paid. See `data/tw0050.README.md`.

### M4 — Bilingual markdown render + local file output (~1 day) — ✅ DONE 2026-05-24
- [x] `src/render/frontmatter.ts` + `src/render/markdown.ts` — VitePress YAML frontmatter (title/date/session/tags/description) + bilingual sections (zh/en headers; Jin10 content stays in zh, Finnhub stays in en; degraded sections carry both-language notices). Markdown tables for econ/earnings/IPO/jin10-econ with `|`-escape + newline-flatten on cells; news rendered as numbered list with clickable links; revenue auto-tiers as $X / $XM / $XB.
- [x] `src/pipeline.ts` — `runPipeline({ date, session })` fetches all six sources in parallel (`Promise.all`), each wrapped in `safe()` that logs `[pipeline] … unavailable: …` + returns `[]` on any throw; filters via M2/M3 strict.ts; renders + writes to `docs/briefs/YYYY-MM-DD-{morning|evening}.md`. `mkdirSync({ recursive: true })` auto-creates `docs/briefs/`.
- [x] CLI wired: `--session=morning|evening` switches from M1–M3 stdout debug mode to pipeline-write mode. Default `--date=` is now session-aware: **morning → tomorrow ET, evening → today ET** (matches the TW wall-clock semantics: morning at 07:30 TW briefs the upcoming US session; evening at 20:00 TW briefs the about-to-open US session).
- [x] Verified live 2026-05-24: `npm run brief -- --date=2026-05-07 --session={morning,evening}` both wrote correctly. Eyeballed: all 7 sections render with bilingual headers, news links clickable, Jin10 flash retains zh-native text + ★ marks, calendar section degrades cleanly with the bilingual NXDOMAIN notice.

### M5 — VitePress site + GitHub Pages deploy (~1 day) — ✅ DONE 2026-05-25
- [x] `docs/.vitepress/config.ts` — site title (`Market Brief 早晚報`), bilingual nav (`首頁/Home`, `最新/Latest` → latest brief link, `全部/All briefs` → `/briefs/`), auto-sidebar generated by reading `docs/briefs/` at config-load time, grouped by `YYYY-MM`, newest-first (evening before morning on the same date). Local search provider enabled. `base` defaults to `/Market_brief/` (project Pages URL) and can be overridden by `VITEPRESS_BASE` env var — the deploy workflow sets it from `actions/configure-pages` `base_path` output, so the site Just Works regardless of repo rename.
- [x] `docs/briefs.data.ts` — VitePress data loader exposing `BriefMeta[]` (date, session, sessionZh, link) to pages. Hot-reloads in dev when `docs/briefs/*.md` changes.
- [x] `docs/index.md` — bilingual landing with VitePress `home` hero layout + three feature cards (07:30 TW morning · 20:00 TW evening · zh+en). Below the hero, `<script setup>` pulls from the data loader to render "最新一篇 / Latest brief" (links to the newest brief) and a "近期 / Recent" list (last 10). Empty-state copy explains how to generate one. About section explains sources, filter, TW0050 gap, Jin10 NXDOMAIN gap, schedule.
- [x] `docs/briefs/index.md` — "All briefs" page; same data loader, grouped by month with year-month headings.
- [x] `.github/workflows/deploy-pages.yml` — `actions/checkout@v4` + `actions/setup-node@v4` (Node 22, npm cache) + `actions/configure-pages@v5` + `npm ci` + `npm run docs:build` + `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`. Two-job build/deploy split. Triggers: push to `main` (only when `docs/**`, workflow file, or lockfile changes) + `workflow_dispatch`. Concurrency group `pages`, `cancel-in-progress: false`. **No `FINNHUB_API_KEY` needed in this workflow** — briefs are already committed by M6's scheduled-brief workflow.
- [x] `package.json` scripts: `docs:dev`, `docs:build`, `docs:preview`.
- [x] `.gitignore` already covered `docs/.vitepress/cache/` and `docs/.vitepress/dist/`.
- [x] Verified local 2026-05-25: `npm run docs:build` exits clean in ~4s; generated `dist/index.html` references all three sample briefs (2026-05-07-morning, 2026-05-07-evening, 2026-05-08-morning); `dist/briefs/index.html` shows the `2026-05` month grouping; sidebar wires the correct `/Market_brief/briefs/...` links. Typecheck still clean.

**Manual one-time setup before site actually deploys (not code — human action required):**
- [ ] `git init && git add . && git commit -m "initial commit"` — repo is not yet a git repo (per environment header on 2026-05-25).
- [ ] Create the GitHub repo (`Market_brief`, **public**) and `git push -u origin main`.
- [ ] GitHub UI → **Settings → Pages → Build and deployment → Source: "GitHub Actions"** (one-time flip; the deploy workflow won't publish without it).
- [ ] GitHub UI → **Settings → Secrets and variables → Actions → New repository secret → `FINNHUB_API_KEY`** (value from local `.env`). Needed by M6's scheduled-brief workflow; deploy-pages alone doesn't need it.
- [ ] After first deploy, confirm the site loads at `https://{user}.github.io/Market_brief/` and that the sidebar / latest-brief / all-briefs page all work.

### M6 — Triggers: slash command + GH Actions cron + optional Task Scheduler (~1 day) — ✅ DONE 2026-05-25 (code-side; cron-cycle verification waits on deploy)
- [x] `.claude/commands/market-brief.md` — minimal publish-only slash command. Accepts `morning`/`evening`/empty as `$ARGUMENTS`; empty auto-detects from current TW hour (00:00–13:59 → morning, 14:00–23:59 → evening). Steps: resolve session → `npm run brief -- --session=<>` → stage only `docs/briefs/<file>.md` → commit `brief: <DATE> <session> (auto)` → `git push`. Hard rules: no `--no-verify`, no `--force`, never echo `FINNHUB_API_KEY`, no source edits, one brief per invocation. `allowed-tools` limited to `npm`/`git`/`date`/`powershell`/`Read`. Pattern follows Email_organizor at a much lighter weight — no Discord notifier, no wrapper script needed (Market_brief just needs to push markdown; deploy-pages picks it up).
- [x] `.github/workflows/scheduled-brief.yml` — two `schedule:` cron entries (`30 23 * * 0-4` morning, `0 12 * * 1-5` evening) + `workflow_dispatch` with session+date inputs. Resolves session by inspecting `github.event.schedule` (or dispatch input). Runs `npm ci` + `npm run brief -- --session=<>` with `FINNHUB_API_KEY` from secrets, then commits with the `github-actions[bot]` identity and pushes to main. Concurrency group `scheduled-brief` serializes overlapping runs. Inline UTC↔TW conversion comment at the top per CLAUDE.md risk note. `permissions: contents: write` is required (and noted in setup checklist).
- [x] **Windows Task Scheduler local backup decision (2026-05-25):** **NOT WIRED for v1.** GH Actions cron is the primary trigger; the slash command is the manual escape hatch. Email_organizor's Task Scheduler wrapping exists because that project must run *on the dev machine* (it talks to local Gmail MCP); Market_brief has no such constraint — it only needs internet + Finnhub + Jin10. Adding a Task Scheduler `.bat` would just be a redundant second cron with worse uptime than GH's. Reopen this only if GH Actions cron proves unreliable for this account (delays > 30 min or skipped days).
- [ ] **Cron-cycle verification** — deferred until the manual-deploy checklist above is done (no git remote yet). Once the repo is pushed and Pages is enabled, watch the first **morning** and **evening** scheduled runs in the Actions tab: confirm the workflow fires at the expected TW wall-clock time (allow ~10 min GH cron jitter), the brief file lands in `docs/briefs/`, the follow-up deploy-pages run publishes it, and the site shows the new entry on `/briefs/` and the landing-page recent list.

## Risks

- **Jin10 endpoint drift** — ⚠️ MATERIALIZED 2026-05-18: flash endpoint differs from the plan (it's `flash-api.jin10.com/get_flash_list`, not `open-data-api`) and the calendar host `cdn-rili.jin10.com` is **dead (NXDOMAIN)**. Flash works and even carries inline economic releases (type=1, `star` rating). The HTML-scrape fallback is NOT viable for the calendar (rili is a socket.io SPA, no static data). Interim: rely on Finnhub global econ (covers JP/KR/CN) + Jin10 flash type=1 for Asia macro. Zod schemas written defensively, flash fixture saved.
- **Cloudflare blocking Jin10 from GitHub Actions IPs** — actions runners are well-known IP ranges; Jin10 may rate-limit or block. Mitigation: in M3, run a dry-run from an Actions runner before relying on it; if blocked, run Jin10 fetch locally via Task Scheduler and only push markdown to GH Actions for build/deploy.
- **Finnhub free-tier coverage of TW tickers** — ⚠️ MATERIALIZED 2026-05-18: not "spotty" — **entirely absent**. Free-tier earnings calendar is US-only (no `.TW`, no exchange suffixes at all in 1500+ rows; `?symbol=` & `/stock/profile2` → 403). Decision per plan: accept the gap, do NOT spike to paid tier. `filterEarningsTw0050()` + `data/tw0050.json` exist and are correct but inert until a TW-capable source is added.
- **Bilingual rendering complexity** — naive zh+en concatenation looks messy; VitePress i18n adds setup overhead. Mitigation: start with single-page bilingual sections (zh block then en block) in M4, defer real i18n routing unless it becomes painful.
- **Cron timezone mistakes** — GH Actions cron runs in UTC; off-by-one is common. Mitigation: write the UTC ↔ TW conversion comment directly in the workflow file, and verify the first scheduled run lands at the correct TW wall-clock time.

## Open Questions

All Phase-1 questions resolved as of 2026-05-09. Remaining items below are deliberately deferred until after M5 ships:

- [x] ~~**Importance ranking signal for "top-5 news"**~~ — RESOLVED 2026-05-18 in M2; see news-ranking decision in "Notes for future Claude sessions".
- [ ] **Earnings universe maintenance** — `data/sp500_tech.json` and `data/tw0050.json` go stale; how often to refresh? Defer; quarterly manual update is fine for v1. Regenerate `sp500_tech.json` from the `datasets/s-and-p-500-companies` constituents CSV (filter GICS `Information Technology` + `Communication Services`, then add `AMZN`, `TSLA`).
- [x] ~~**Public vs. private GH Pages**~~ — RESOLVED 2026-05-25: user asked for the trade-offs and chose **public repo + GitHub Pages** (after I flagged that private Pages requires a paid GitHub plan). Decision recorded in "Notes for future Claude sessions" below.

## Notes for future Claude sessions

- **Source decision history (do not relitigate):** investing.com was rejected 2026-05-09 (Cloudflare risk + no BMO/AMC + weak Asia). Jin10+Finnhub hybrid was chosen for: native zh macro from Jin10, BMO/AMC + structured calendars from Finnhub.
- **Output decision:** user wants a **hosted site**, not a local file or notification. Don't suggest reverting to Markdown-in-`reports/` — that was the original plan and was explicitly upgraded.
- **Trigger decision:** both manual slash command **and** scheduled. Don't drop one for "simplicity."
- **Schedule decision:** 07:30 TW + 20:00 TW, weekdays. UTC equivalents: `30 23 * * 0-4` and `0 12 * * 1-5`. Confirm timezone math on first deploy.
- **Filter decision:** strict — high-signal only. Resist scope creep into "comprehensive sweep."
- **Earnings universe decision (2026-05-17, do not relitigate):** the earnings filter is the **S&P 500 tech basket**, NOT raw S&P 500 and NOT Nasdaq 100. User iterated through all three; final pick is GICS `Information Technology` + `Communication Services` constituents of the S&P 500, plus `AMZN` and `TSLA` (tech-adjacent megacaps in Consumer Discretionary). ~98 tickers in `data/sp500_tech.json`. Implemented as `filterEarningsSp500Tech()` in `src/filter/strict.ts`. Do not revert to `data/sp500.json` (full S&P 500) or `data/ndx100.json` (Nasdaq 100) — those intermediate files were deleted.
- **Finnhub free tier:** `/index/constituents` (S&P 500 / NDX membership) returns **403** on free tier — must source ticker universes from static files, not the API. `/calendar/earnings`, `/calendar/ipo`, and `/news` work free-tier (verified 2026-05-18, still working 2026-06-19). **`/calendar/economic` went paid 2026-06-19** — same key that worked 2026-05-18 now returns `403 {"error":"You don't have access to this resource."}` (Finnhub's standard paid-only wording). Finnhub even spun up a dedicated `pricing-economic-data-api` page for the SKU. **We switched econ to Forex Factory** — see the Forex Factory note below. `/news` is a **latest feed with no from/to**: it returns current news regardless of `--date`. Correct for same-day morning/evening briefs; means historical `--date` runs show today's news, not that date's.
- **Forex Factory econ calendar (2026-06-19, do not relitigate):** after Finnhub gated `/calendar/economic`, we evaluated FMP (`/stable/economic-calendar` → HTTP 402 paid-only too), Trading Economics (`guest:guest` mode was discontinued — HTTP 410), and Forex Factory's public weekly JSON. **Forex Factory wins**: `https://nfs.faireconomy.media/ff_calendar_thisweek.json` — no auth, no key, no rate limit in production (one fetch per cron). Returns the current week, ~100 events, 10 currencies (USD/GBP/EUR/JPY/CNY/CAD/AUD/NZD/CHF/All). Fields: `title`, `country` (currency code), `date` (ISO with ET offset), `impact` ("Low" | "Medium" | "High" | "Holiday"), `forecast`, `previous` (display strings preserving "%", "K", etc.). Implementation in `src/sources/forexfactory.ts`: never throws (logs + returns []), shims rows into `EconomicItem` shape so `filterEconomic3Star()` and the renderer work unchanged. Currency-code → country-label map lives in `COUNTRY_MAP` inside that file. `Holiday` rows are dropped at fetch time. Pipeline filters the full-week feed to the brief date via `it.time.slice(0, 10) === date` (works because FF's ET offset matches the brief's ET anchor). New optional fields `estimateText`/`prevText` on `EconomicItem` carry the display strings so the renderer can show "62K" / "1.2%" instead of stripping units. Do NOT spike to a paid Finnhub or FMP plan unless Forex Factory itself goes away.
- **News-ranking decision (2026-05-18, do not relitigate):** top-5 news uses a deliberately simple, explainable heuristic in `rankTopNews()` (`src/filter/strict.ts`): score = source weight (reputable wires/financial press = 5, mainstream business outlets = 2, else 1) + ticker-mention bonus (+3 if a tracked tech ticker is in Finnhub's structured `related` field; +2 if a tracked ticker, length ≥ 3 to avoid "A"/"ON"/"IT" false positives, appears as a standalone word in the headline). Sorted by score desc, newer-first tie-break, top 5. Observed: macro/geopolitical wire news rarely carries tracked tickers, so ranking often degrades to "latest reputable-source news" — acceptable for v1. Do NOT replace with LLM scoring without explicit ask (out of scope per CLAUDE.md).
- **Jin10 endpoint decision (2026-05-18, do not relitigate):** flash = `https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1` with `User-Agent` + `x-app-id: bVBF4FyRTn5NJF5n` + `x-version: 1.0.0` (public web-client ids, not paid). Items: `type` 0 = news/flash text, 1 = economic release (`data.star` importance, ≥3 = high — Jin10's own rule), 2 = other. Asia calendar host `cdn-rili.jin10.com` is dead (NXDOMAIN); `fetchJin10Calendar()` is intentionally kept pointing there so it self-heals if revived, but expect `[]`. Do NOT waste time re-hunting the calendar host or building a socket.io client — out of scope; use Finnhub global econ + flash type=1 for Asia macro instead.
- **TW0050 decision (2026-05-18):** `data/tw0050.json` + `filterEarningsTw0050()` are correct but **inert** (Finnhub free tier US-only). Do NOT relitigate or spike to paid Finnhub. List is an approximate as-of-2026-05 snapshot; refresh quarterly per the open question. See `data/tw0050.README.md`.
- **Asia calendar gap accepted for v1 (2026-05-24, do not relitigate):** user explicitly accepted shipping without a dedicated Jin10 Asia *calendar* (cdn-rili host dead). Asia macro substance is covered by (a) Finnhub global econ which includes JP/KR/CN/AU/GB, and (b) Jin10 flash type=1 economic releases. The "金十亞洲日曆" markdown section ships with a permanent bilingual placeholder explaining this. Do NOT hunt for an alternate Asia-calendar provider unless the user reopens the question.
- **Brief filename + CLI decision (2026-05-24):** generated files live at `docs/briefs/YYYY-MM-DD-{morning|evening}.md`. `npm run brief -- --session=morning|evening [--date=YYYY-MM-DD]` runs the pipeline; default date is **session-aware** (morning=tomorrow ET, evening=today ET) — both correspond to the same TW wall-clock day the brief is for. Without `--session`, CLI stays in the M1–M3 stdout debug mode (do not break this; it's the developer ergonomics path).
- **Public repo + GitHub Pages decision (2026-05-25, do not relitigate):** user weighed private vs public and went **public** after I noted that private Pages needs a paid GitHub plan. Hosting is GitHub Pages, served from the project Pages URL (`/{repo}/`). The `base` path is supplied at build time by `actions/configure-pages` via the `VITEPRESS_BASE` env var, so the site is portable across repo renames or a custom-domain move (override env, no code change). The `deploy-pages.yml` workflow uses the official `actions/deploy-pages@v4` path (no `gh-pages` branch). If the user later wants to lock the digest down, the VitePress `dist/` is portable — switch to Netlify-with-password or Cloudflare Pages + Access; do not re-architect the build itself.
- **VitePress + i18n decision (2026-05-25):** site uses bilingual nav labels (`首頁 / Home`, `最新 / Latest`, `全部 / All briefs`) and in-page bilingual section headers, but **no VitePress i18n routing** (no `/zh/` + `/en/` parallel trees). Per CLAUDE.md M4, this was deliberate to avoid setup overhead for a single-author single-page bilingual layout. Sidebar is auto-generated from `docs/briefs/` filenames at config-load time — new briefs appear on the next build without manual edits. Do not switch to i18n routing unless the user explicitly asks; doubling the page count without changing content adds maintenance burden.
- **M6 trigger architecture (2026-05-25, do not relitigate):** GH Actions cron is the **primary** trigger (`.github/workflows/scheduled-brief.yml`, two `schedule:` entries); the slash command (`.claude/commands/market-brief.md`) is the **manual escape hatch** for one-off / catch-up runs. Windows Task Scheduler is intentionally NOT wired (unlike Email_organizor, which needs the local machine for its Gmail MCP). The cron workflow commits the new brief back to `main` with the `github-actions[bot]` identity, and `deploy-pages.yml`'s `paths: docs/**` filter picks it up automatically — there is NO direct deploy from the cron workflow. Two workflows, one boundary: scheduled-brief generates, deploy-pages publishes. Do not merge them; the separation lets manual `workflow_dispatch` on either work independently.
- **Cron timezone math (2026-05-25):** `30 23 * * 0-4` = 23:30 UTC Sun–Thu = 07:30 TW Mon–Fri (morning). `0 12 * * 1-5` = 12:00 UTC Mon–Fri = 20:00 TW Mon–Fri (evening). Inline comment at the top of `scheduled-brief.yml`. Verify on the first real run — GH cron can lag up to ~10 min and the day-of-week wrap (UTC Sun = TW Mon for morning) is the classic off-by-one trap.
- **Package manager reality:** shipped with **npm**, not pnpm (not installed on dev machine). Use `npm run brief -- --date=YYYY-MM-DD`. CLAUDE.md scripts that say `pnpm brief` mean `npm run brief`.
- **Comparable project:** `E:\AI\Claude_code\Email_organizor` uses Task Scheduler + slash command pattern. Reuse ideas (not code) for trigger wiring.
- **Why not Python:** user explicitly chose TS for this project. Python is the default elsewhere; TS here is a deliberate switch driven by the static-site output target.
