# LewdCorner support — deferred

Notes captured while building F95 download support. Nothing here is
implemented. Written down so the next pass starts from what we already know
rather than rediscovering it.

Status: **deliberately out of scope.** The decision was to get F95 working end
to end first.

---

## What already exists

LewdCorner is not a greenfield integration — a fair amount is in place:

- `electron/db/lewdcorner.js` — mappings, `parseLewdCornerIdFromUrl`,
  `searchAtlasByLewdCornerId`, `findRecordByLewdCornerId`
- `electron/accounts/xenforoAuth.js` — `SITES.lewdcorner` is configured
  (`lewdcorner.com`), so login uses the same XenForo path as F95
- `accountStore` handles LC cookies via the same `siteForUrl` routing
- Catalog side: a `lewdcorner` table with a `downloads` column, plus
  `lc_review_queue` and the reconciler
- Scraper: `agents/lewdcorner.py`, `agents/lc_detail.py`, and five `lc_*`
  fixtures

So auth and metadata are largely solved. The gap is the download path.

---

## Known differences from F95

**1. No `/masked/` equivalent observed.**
F95 wraps links in an AES+HMAC masked URL tied to the viewer's user id.
Nothing similar has been confirmed on LC. If LC links are plain host URLs,
the entire masked-resolver stage is unnecessary — go straight from parsed
link to host plugin. **Verify before building anything.**

**2. Different table shape.**
`lewdcorner` has `downloads` but no `patches` / `extras` / `translations`
columns, unlike `f95_zone`. Whatever the LC parser produces has to fit one
column, or the schema needs extending.

**3. Tier-gated content.**
`lewdcorner.tier` and `prefixes` exist in the catalog, and there is a
`lewdcorner-tier.test.js` in the suite. Some content is likely restricted by
supporter tier. A download attempt against a tier the user does not have will
fail in a way the queue should explain, not report as a generic error.

**4. Thread parsing is unported.**
`f95ThreadParser.js` is an F95-specific port of `f95_detail.py`. LC's markup
is also XenForo, so the bucket state machine probably transfers, but the
selectors and the divider vocabulary need checking against the `lc_*`
fixtures.

---

## What to do first

1. **Look at a real LC thread's download block.** Are the links masked,
   wrapped, or plain? That single answer decides whether this is a week of
   work or an afternoon.
2. **Check host overlap.** If LC threads mostly use Mega / Pixeldrain /
   Gofile, the existing host plugins cover it and only the parsing layer is
   new. Run `download_link_metrics.py --table lewdcorner` — it already
   accepts a `--table` argument.
3. **Decide on tier handling.** Probably a distinct `classifyError` kind
   (`tier`) alongside `quota` / `auth`, so the queue can say "this needs a
   higher supporter tier" instead of "failed".

---

## Things to reuse rather than rebuild

- `groupClassifier.js` is host- and site-agnostic. LC group headings need
  checking against its vocabulary, but the two-axis platform/kind logic
  should hold.
- The host plugin registry does not care which forum a link came from. An LC
  Pixeldrain link works with the existing plugin today.
- `versionFromFile.js` is filename-only and site-independent.
- The queue, retry policy, credential store and install flow are all
  source-agnostic.

Realistically the LC-specific work is: a thread parser, a link-resolution
stage (possibly none), and tier-aware error handling.

---

## Open questions

- Does LC rate-limit thread fetches more aggressively than F95?
- Is there an LC equivalent of F95's per-user link minting? If so the same
  "each user mints their own" constraint applies and links cannot be shipped
  in the catalog.
- Should LC and F95 mirrors appear in the same update modal for a game mapped
  to both, or should the user pick a source first?
