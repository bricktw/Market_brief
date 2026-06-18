# Market Brief 早晚報

Daily bilingual (中文 / English) finance digest. Pulls high-signal macro + earnings + IPO + news from **Jin10** and **Finnhub**, renders bilingual Markdown, and publishes a static **VitePress** site to **GitHub Pages**. Runs twice per weekday on GitHub Actions cron (07:30 TW morning · 20:00 TW evening) with a Claude Code `/market-brief` slash command as the manual escape hatch.

See `CLAUDE.md` for the full architecture, decision log, and known-gap notes (Jin10 calendar host is NXDOMAIN; Finnhub free tier is US-only, so the TW0050 filter is inert). This README covers **deploy only**.

---

## Local quick-start

```powershell
npm ci
copy .env.example .env          # then paste FINNHUB_API_KEY=...
npm run brief -- --session=morning      # writes docs/briefs/YYYY-MM-DD-morning.md
npm run docs:dev                        # preview at http://localhost:5173
```

Useful scripts (`package.json`):

| script | what it does |
| --- | --- |
| `npm run brief -- --session=morning\|evening [--date=YYYY-MM-DD]` | run the pipeline, write one brief |
| `npm run docs:dev` | VitePress dev server with hot reload |
| `npm run docs:build` | build static site into `docs/.vitepress/dist` |
| `npm run docs:preview` | serve the built site locally |
| `npm run typecheck` | `tsc --noEmit` |

---

## First-time deploy (one-time manual steps)

These steps only need to happen **once**. After that, everything is automatic: cron generates briefs, push to `main` deploys.

### 1. Initialize the repo and push to GitHub

```powershell
git init
git add .
git commit -m "initial commit"
# Create a new PUBLIC repo on github.com named "Market_brief" — do NOT add a README/license on the GitHub side.
git remote add origin https://github.com/<your-user>/Market_brief.git
git branch -M main
git push -u origin main
```

> Public repo is intentional — private Pages requires a paid GitHub plan. See the decision note in `CLAUDE.md`. If you later want to lock the digest down, the built `dist/` is portable to Netlify-with-password or Cloudflare Pages + Access.

### 2. Configure GitHub Pages

GitHub UI → **Settings → Pages → Build and deployment**:
- **Source:** `GitHub Actions`

(No branch picker — the official `actions/deploy-pages@v4` path doesn't use a `gh-pages` branch.)

### 3. Give the cron workflow push permission

GitHub UI → **Settings → Actions → General → Workflow permissions**:
- Select **Read and write permissions**

Without this, `scheduled-brief.yml` can fetch + build but can't commit the brief back to `main`.

### 4. Add the Finnhub secret

GitHub UI → **Settings → Secrets and variables → Actions → New repository secret**:
- **Name:** `FINNHUB_API_KEY`
- **Value:** the key from your local `.env`

Only the cron workflow uses it; `deploy-pages.yml` doesn't need any secrets.

### 5. First deploy and verify

The first push to `main` triggers `deploy-pages.yml` automatically. Watch it under **Actions**, then confirm:

- Site loads at `https://<your-user>.github.io/Market_brief/`
- Sidebar lists the sample briefs under their YYYY-MM month
- Landing page shows "Latest brief" + "Recent" lists
- `/briefs/` renders the all-briefs index

### 6. First scheduled-cron verification

After the deploy is live, the next scheduled run should fire at:
- **07:30 TW Mon–Fri** (cron `30 23 * * 0-4` UTC) — morning
- **20:00 TW Mon–Fri** (cron `0 12 * * 1-5` UTC) — evening

GitHub may delay cron up to ~10 minutes. Confirm under **Actions** that:
1. `Scheduled brief` runs at the expected TW wall-clock time.
2. A new file `docs/briefs/YYYY-MM-DD-<session>.md` lands on `main`.
3. `Deploy site` then fires automatically (triggered by the `docs/**` push).
4. The site shows the new entry on the landing-page recent list and `/briefs/`.

---

## How the two workflows fit together

```
                ┌─────────────────────────┐
   cron ──────► │ scheduled-brief.yml     │ ── commits docs/briefs/*.md ──┐
   /market-brief│  • npm ci                                                │
   (local)      │  • npm run brief --session=X                             │
                │  • commit & push as github-actions[bot]                  │
                └─────────────────────────┘                                │
                                                                          ▼
                                                        push to main (paths: docs/**)
                                                                          │
                                                                          ▼
                                                        ┌─────────────────────────┐
                                                        │ deploy-pages.yml        │
                                                        │  • build VitePress      │
                                                        │  • deploy to GH Pages   │
                                                        └─────────────────────────┘
```

**One boundary, two responsibilities.** Don't merge them — the separation lets either workflow be re-run manually via **workflow_dispatch** without the other.

---

## Manual one-off / catch-up runs

Three independent escape hatches, in order of friction:

1. **`/market-brief [morning|evening]`** — Claude Code slash command. Runs the pipeline, commits, pushes. Empty arg auto-detects from the current TW hour (00:00–13:59 → morning, 14:00–23:59 → evening).
2. **GitHub UI → Actions → Scheduled brief → Run workflow** — pick session (and optional `YYYY-MM-DD`); runs in the cloud, commits as `github-actions[bot]`.
3. **GitHub UI → Actions → Deploy site → Run workflow** — only republishes from whatever is on `main`; doesn't regenerate any brief.

---

## Operational notes

- **Schedule math:** `30 23 * * 0-4` = 23:30 UTC Sun–Thu = 07:30 TW Mon–Fri. `0 12 * * 1-5` = 12:00 UTC Mon–Fri = 20:00 TW Mon–Fri. UTC day-of-week wraps a day behind for the morning entry — this is the classic off-by-one gotcha; verify on the first real run.
- **Concurrency:** both workflows use `cancel-in-progress: false` — a delayed run is not dropped on the floor.
- **Idempotency:** the cron workflow exits cleanly if `git diff --cached --quiet` shows no new brief content. Re-running the slash command on an unchanged file skips the push.
- **Secrets hygiene:** `FINNHUB_API_KEY` lives in `.env` locally (gitignored) and in **repo secrets** in the cloud. It is never echoed by the pipeline, the slash command, or either workflow.
- **Base path portability:** `docs/.vitepress/config.ts` reads `process.env.VITEPRESS_BASE`, which `deploy-pages.yml` sets from `actions/configure-pages@v5`'s `base_path` output. Rename the repo or move to a custom domain — no code change needed; the build will pick up the new base at deploy time.
