---
layout: home

hero:
  name: "Market Brief"
  text: "早晚報"
  tagline: "Daily bilingual finance digest — Jin10 macro flash + Finnhub US earnings, IPO, news, and economic calendar. Twice per weekday."
  actions:
    - theme: brief
      text: 最新 Latest brief →
      link: /briefs/

features:
  - icon: 🕖
    title: 07:30 TW · 早報 Morning
    details: Previous US session close + today's TW pre-open. Filed before Asia opens.
  - icon: 🌙
    title: 20:00 TW · 晚報 Evening
    details: Today's TW close + the about-to-open US session. Filed before US bell.
  - icon: 🇹🇼🇺🇸
    title: 雙語 · zh + en
    details: Jin10 content stays in 中文; Finnhub stays in English. Headers carry both languages.
---

<script setup>
import { data as briefs } from './briefs.data.ts'

const latest = briefs[0]
const recent = briefs.slice(0, 10)
</script>

## 最新一篇 / Latest brief

<div v-if="latest">
  <p><a :href="latest.link"><strong>{{ latest.date }} · {{ latest.sessionZh }} / {{ latest.session === 'morning' ? 'Morning Brief' : 'Evening Brief' }}</strong></a></p>
</div>
<div v-else>
  <p><em>No briefs yet. Run <code>npm run brief -- --session=morning</code> or <code>--session=evening</code> to generate one.</em></p>
</div>

## 近期 / Recent

<ul v-if="recent.length">
  <li v-for="b in recent" :key="b.link">
    <a :href="b.link">{{ b.date }} · {{ b.sessionZh }} / {{ b.session === 'morning' ? 'Morning' : 'Evening' }}</a>
  </li>
</ul>
<p v-else><em>No recent briefs.</em></p>

## 關於 / About

- **Sources**: [Jin10 flash 金十快訊](https://www.jin10.com/) (zh-native macro) + [Finnhub](https://finnhub.io/) (US earnings, IPO, news, global economic calendar).
- **Filter (strict, high-signal only)**: economic ≥ 3★ · S&P 500 tech earnings · top-5 news (source weight + ticker relevance) · IPO calendar · Jin10 flash with ★ marks · Jin10 economic releases ≥ 3★.
- **TW0050**: tracked but inert — Finnhub free tier is US-only.
- **Jin10 Asia calendar**: source host currently unreachable (NXDOMAIN). Asia macro coverage is provided via Finnhub's global economic calendar plus the Jin10 flash stream.
- **Schedule**: weekdays at 07:30 TW (morning) and 20:00 TW (evening) — GitHub Actions cron.
