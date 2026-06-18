---
title: 全部 / All briefs
---

<script setup>
import { data as briefs } from '../briefs.data.ts'

const byMonth = {}
for (const b of briefs) {
  const ym = b.date.slice(0, 7)
  ;(byMonth[ym] = byMonth[ym] || []).push(b)
}
const months = Object.keys(byMonth).sort().reverse()
</script>

# 全部 / All briefs

<div v-if="briefs.length === 0">
  <p><em>No briefs yet.</em></p>
</div>

<div v-for="ym in months" :key="ym">
  <h2 :id="ym">{{ ym }}</h2>
  <ul>
    <li v-for="b in byMonth[ym]" :key="b.link">
      <a :href="b.link">{{ b.date }} · {{ b.sessionZh }} / {{ b.session === 'morning' ? 'Morning' : 'Evening' }}</a>
    </li>
  </ul>
</div>
