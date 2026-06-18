// ---------------------------------------------------------------------------
// VitePress data loader — exposes the list of generated briefs to pages.
//
// Usage in a .md file:
//   <script setup>
//   import { data as briefs } from './briefs.data.ts'
//   </script>
//
// Pages reload automatically when files under docs/briefs/ change (dev mode).
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const briefsDir = resolve(here, "briefs");

export interface BriefMeta {
  date: string;          // YYYY-MM-DD
  session: "morning" | "evening";
  sessionZh: string;     // 早報 / 晚報
  link: string;          // /briefs/{slug}
}

declare const data: BriefMeta[];
export { data };

export default {
  watch: ["./briefs/*.md"],

  load(): BriefMeta[] {
    let names: string[] = [];
    try {
      names = readdirSync(briefsDir);
    } catch {
      return [];
    }
    const re = /^(\d{4}-\d{2}-\d{2})-(morning|evening)\.md$/;
    const out: BriefMeta[] = [];
    for (const n of names) {
      const m = re.exec(n);
      if (!m) continue;
      const date = m[1]!;
      const session = m[2] as "morning" | "evening";
      out.push({
        date,
        session,
        sessionZh: session === "morning" ? "早報" : "晚報",
        link: `/briefs/${n.replace(/\.md$/, "")}`,
      });
    }
    out.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.session === b.session) return 0;
      return a.session === "evening" ? -1 : 1;
    });
    return out;
  },
};
