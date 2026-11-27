'use strict'

// Multi-step LewdCorner tier check: homepage banner → rank-card → thread
// probe. The first definitive verdict ('VIP'/'Free') wins and stops the
// pipeline; null is inconclusive and falls through to the next check.

const {
  scrapeLcTierFromProfile,
  probeLcTierFromThread,
  cookieHeaderFromArray,
  SITES,
} = require('./xenforoAuth')
const { fetchUrlViaWindow, isAvailable } = require('../downloads/forumWindowFetch')

// data-state="owned" = Plus, "progress" = free. The state regex is scoped to
// the one opening tag carrying jblcMemberGuide, so attribute order is free.
function parseHomepageBanner(html) {
  const tag = /<section[^>]*class="[^"]*jblcMemberGuide[^"]*"[^>]*>/.exec(String(html || ''))
  if (!tag) return null
  const state = /data-state="(owned|progress)"/.exec(tag[0])
  if (!state) return null
  return state[1] === 'owned' ? 'VIP' : 'Free'
}

// Fetches the homepage through the real-browser window, which keeps the
// resolver partition's cf_clearance grant. Null falls through to rank-card.
async function checkHomepageBanner(ctx) {
  if (!isAvailable()) return null
  const cookieHeader = cookieHeaderFromArray(ctx.cookies)
  if (!cookieHeader) return null
  try {
    const html = await fetchUrlViaWindow(SITES.lewdcorner.base + '/', cookieHeader, {
      host: SITES.lewdcorner.domain,
      timeoutMs: 60000,
    })
    if (!html) return null
    return parseHomepageBanner(html)
  } catch {
    return null
  }
}

// Fallback: the existing rank-card shop-page parse.
async function checkRankCard(ctx) {
  return scrapeLcTierFromProfile(ctx.cookies)
}

// Fallback: the existing thread probe (disabled by default via lcConfig).
async function checkThreadProbe(ctx) {
  return probeLcTierFromThread(ctx.cookies, ctx.lcConfig)
}

// Ordered pipeline. Each entry runs in turn; the first definitive verdict wins.
const LC_TIER_CHECKS = [
  { name: 'homepage', run: checkHomepageBanner },
  { name: 'rank-card', run: checkRankCard },
  { name: 'thread-probe', run: checkThreadProbe },
]

// Run the pipeline. Returns { tier: 'VIP' | 'Free' | null, source: name | null }
// where source names the check that produced the verdict.
async function checkLcTier(ctx) {
  for (const check of LC_TIER_CHECKS) {
    let verdict = null
    try {
      verdict = await check.run(ctx)
    } catch {
      verdict = null
    }
    if (verdict === 'VIP' || verdict === 'Free') {
      return { tier: verdict, source: check.name }
    }
  }
  return { tier: null, source: null }
}

module.exports = {
  checkLcTier,
  checkHomepageBanner,
  checkRankCard,
  checkThreadProbe,
  parseHomepageBanner,
  LC_TIER_CHECKS,
}
