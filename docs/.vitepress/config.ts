// ---------------------------------------------------------------------------
// VitePress site config — Market Brief bilingual digest.
//
// Layout: single-page bilingual briefs under /briefs/, plus a landing page.
// We do NOT use VitePress's full i18n routing (decision in CLAUDE.md M4):
// section headers carry both languages in-page; the site chrome is bilingual
// in the nav labels themselves.
//
// Sidebar is generated at config-load time by reading `docs/briefs/`, grouping
// by year-month, and sorting newest-first. New briefs appear automatically on
// the next build.
//
// `base` defaults to "/Market_brief/" (project-style GitHub Pages URL). Override
// via env when deploying to a custom domain or a user/org Pages site:
//     VITEPRESS_BASE=/ npm run docs:build
// ---------------------------------------------------------------------------

import { defineConfig, type DefaultTheme } from "vitepress";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const briefsDir = resolve(here, "..", "briefs");

interface BriefFile {
  date: string;          // YYYY-MM-DD
  session: "morning" | "evening";
  slug: string;          // filename without .md
  link: string;          // VitePress link (no .md, leading /)
  ym: string;            // YYYY-MM grouping key
}

function listBriefs(): BriefFile[] {
  let names: string[] = [];
  try {
    names = readdirSync(briefsDir);
  } catch {
    return [];
  }
  const out: BriefFile[] = [];
  const re = /^(\d{4}-\d{2}-\d{2})-(morning|evening)\.md$/;
  for (const n of names) {
    const m = re.exec(n);
    if (!m) continue;
    const date = m[1]!;
    const session = m[2] as "morning" | "evening";
    const slug = n.replace(/\.md$/, "");
    out.push({
      date,
      session,
      slug,
      link: `/briefs/${slug}`,
      ym: date.slice(0, 7),
    });
  }
  // Newest first; evening before morning on the same date (evening is published
  // ~12 hours later, so it represents the "later" snapshot).
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.session === b.session) return 0;
    return a.session === "evening" ? -1 : 1;
  });
  return out;
}

function buildSidebar(): DefaultTheme.SidebarItem[] {
  const briefs = listBriefs();
  if (briefs.length === 0) {
    return [{ text: "Briefs 早晚報", items: [] }];
  }
  // Group by year-month for clean nav once history grows.
  const byMonth = new Map<string, BriefFile[]>();
  for (const b of briefs) {
    const arr = byMonth.get(b.ym) ?? [];
    arr.push(b);
    byMonth.set(b.ym, arr);
  }
  const months = [...byMonth.keys()].sort().reverse();
  return months.map((ym) => ({
    text: ym,
    collapsed: false,
    items: byMonth.get(ym)!.map((b) => ({
      text: `${b.date} · ${b.session === "morning" ? "早報" : "晚報"}`,
      link: b.link,
    })),
  }));
}

const briefs = listBriefs();
const latest = briefs[0];

export default defineConfig({
  title: "Market Brief 早晚報",
  description:
    "Daily bilingual finance digest (zh/en) — Jin10 macro flash + Finnhub US earnings/IPO/news/economic. Twice per weekday.",
  lang: "zh-TW",
  base: process.env.VITEPRESS_BASE ?? "/Market_brief/",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  head: [
    ["meta", { name: "theme-color", content: "#0f766e" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Market Brief 早晚報" }],
  ],

  themeConfig: {
    nav: [
      { text: "首頁 / Home", link: "/" },
      {
        text: "最新 / Latest",
        link: latest ? latest.link : "/",
      },
      { text: "全部 / All briefs", link: "/briefs/" },
    ],
    sidebar: {
      "/briefs/": buildSidebar(),
    },
    outline: { level: [2, 3], label: "On this page 本頁目錄" },
    docFooter: { prev: "← 上一篇 / Prev", next: "下一篇 / Next →" },
    lastUpdatedText: "Last updated 最後更新",
    footer: {
      message:
        "Auto-generated bilingual digest · 自動產生雙語摘要 · Sources: Jin10 + Finnhub",
      copyright: "Market Brief — for personal use",
    },
    search: { provider: "local" },
  },
});
