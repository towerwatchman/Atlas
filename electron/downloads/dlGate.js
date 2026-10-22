"use strict";

// F95's new download flow is an intermediate page on f95zone.to itself:
// /dl/<postId>/?u=...&k=...&t=... That page's own f95dl JS walks Continue ->
// countdown -> "Generate your link" -> mirror.

// Hard ceiling on hiding the window: a stuck page must not stay hidden forever.
const DL_HOLD_MS = 10000;

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

// Hide only while the /dl/ countdown runs. The clock starts at the first
// sighting, not the last poll: poll timestamps refresh every tick, so a frozen
// page would look fresh forever on that clock.
function holdReveal(lastPoll, now, firstDlActiveAt) {
  if (!lastPoll) return false;
  if (!lastPoll.dlActive) return false;
  const first = firstDlActiveAt == null ? lastPoll.at : firstDlActiveAt;
  return now - first < DL_HOLD_MS;
}

module.exports = { DL_POLL_SCRIPT, holdReveal };
