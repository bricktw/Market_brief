---
description: Generate today's Market Brief (morning or evening), commit and push to publish on the site.
allowed-tools: Bash(npm:*), Bash(git:*), Bash(date:*), Bash(powershell:*), Read
argument-hint: "[morning|evening]   # omit to auto-detect from current TW hour"
---

Generate one Market Brief and publish it. `$ARGUMENTS` may be `morning`, `evening`, or empty.

## Steps

1. **Resolve session.**
   - If `$ARGUMENTS` is exactly `morning` or `evening`, use that.
   - If empty, auto-detect from the current TW hour (you already know today's date and time from your context; convert to TW if needed):
     - **00:00 – 13:59 TW → `morning`** (briefs the upcoming US session)
     - **14:00 – 23:59 TW → `evening`** (briefs the about-to-open US session)
   - If `$ARGUMENTS` is anything else, abort with an error message and do not run anything else.

2. **Run the pipeline.** From the project root (`E:\AI\Claude_code\Market_brief`):
   ```
   npm run brief -- --session=<morning|evening>
   ```
   The pipeline prints a final line of the form `Brief written: <absolute path>`. Capture that path. If `npm run brief` exits non-zero, surface the error and stop — do **not** commit a partial / missing file.

3. **Stage and commit.**
   - `git add docs/briefs/<file>.md` (only the generated file).
   - Compute a commit message: `brief: <DATE> <session> (auto)` where `<DATE>` is the YYYY-MM-DD from the filename.
   - `git commit -m "<message>"`. If the working tree is clean (e.g. re-run on an already-committed file with no changes), report `nothing to commit` and skip the push step rather than failing.

4. **Push.** `git push` to the default upstream (`origin main`). If push fails, report the error verbatim — do not retry, do not force.

5. **Report one line.**
   `✓ <DATE> <session> brief published — docs/briefs/<file>.md`

## Hard rules

- **Never** pass `--no-verify` to git, never `--force` the push, never amend a previous commit.
- **Never** echo, log, or commit the value of `FINNHUB_API_KEY`. The pipeline reads it from `.env` (gitignored); your job is just to drive npm + git.
- **Do not** edit any source files. This command is a publish-only path. If the pipeline crashes, surface the error so the user can fix it manually — do not "fix it" inline.
- Run from the project root only. Do not `cd` elsewhere.
- One brief per invocation. If the user wants both sessions, they invoke the command twice.
