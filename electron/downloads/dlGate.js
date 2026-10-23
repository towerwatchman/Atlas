"use strict";

// F95's new download flow is an intermediate page on f95zone.to itself:
// /dl/<postId>/?u=...&k=...&t=... That page's own f95dl JS walks Continue ->
// countdown -> "Generate your link" -> mirror.

// How long the window may stay hidden after the last meaningful step. A live
// countdown counts while its seconds move; a challenge that passes on its own
// navigates. Only a page waiting on a human goes quiet this long.
const IDLE_REVEAL_MS = 4000;

// A navigation that has not reached its document yet is loading, not waiting on
// a human: a slow response or a redirect chain can outlast the idle window with
// no event to reset it. Give it this long to reach dom-ready, then treat the
// page normally. The cap matters because a request that never answers must
// still be shown rather than hidden for the whole resolve budget.
const LOAD_GRACE_MS = 15000;

const DL_POLL_SCRIPT = `(() => {
  const declared = document.querySelector('.f95dl-link-host');
  const declaredHost = declared ? ((declared.textContent || '').trim() || null) : null;
  const snap = (o) => ({ dlActive: false, clicked: false, seconds: null, declaredHost, ...o });
  const countdown = document.querySelector('.js-f95dlCountdown');
  if (countdown && !countdown.classList.contains('u-hidden')) {
    const node = countdown.querySelector('.js-f95dlSeconds');
    const seconds = node ? parseInt(node.textContent, 10) : NaN;
    return snap({ dlActive: true, seconds: Number.isNaN(seconds) ? null : seconds });
  }
  const form = document.querySelector('form[action*="/dl/"]');
  if (!form) return snap();
  const cont = form.querySelector('.js-f95dlContinue');
  if (cont) {
    cont.click();
    return snap({ clicked: 'continue' });
  }
  const target = [...form.querySelectorAll('button, a[role="button"]')]
    .find((b) => ((b.textContent || '').trim().toLowerCase()).startsWith('generate'));
  if (target) {
    target.click();
    return snap({ clicked: 'generate' });
  }
  return snap();
})()`;

// Reveal once the page stops making steps. The caller marks progress on every
// navigation, load event, continue link, countdown tick and download, so only a
// page waiting for something the user must do - or one that has died - reaches
// the idle window. A countdown that freezes in place stops marking progress,
// which is exactly when the window should be shown.
function shouldReveal({ settled = false, revealed = false, lastProgressAt }, now, idleMs = IDLE_REVEAL_MS) {
  if (settled || revealed) return false;
  return now - lastProgressAt >= idleMs;
}

module.exports = { DL_POLL_SCRIPT, shouldReveal, IDLE_REVEAL_MS, LOAD_GRACE_MS };
