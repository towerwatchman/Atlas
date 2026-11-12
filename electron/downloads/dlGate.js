"use strict";

// F95's /dl/ gate page: Continue -> countdown -> "Generate your link" -> mirror.

// Hidden window may stay dark this long after the last step.
const IDLE_REVEAL_MS = 4000;

// Max wait for a navigation to reach dom-ready before treating it as stalled.
const LOAD_GRACE_MS = 15000;

// hCaptcha's own #anchor widget lives inside its iframe, which a poll injection
// cannot reach; the container the gate page owns is the part that is visible.
const CAPTCHA_SELECTOR = '[data-sitekey], iframe[src*="hcaptcha.com"]';

const DL_POLL_SCRIPT = `(() => {
  const declared = document.querySelector('.f95dl-link-host');
  const declaredHost = declared ? ((declared.textContent || '').trim() || null) : null;
  const snap = (o) => ({ dlActive: false, clicked: false, seconds: null, declaredHost, captcha: false, ...o });
  const countdown = document.querySelector('.js-f95dlCountdown');
  if (countdown && !countdown.classList.contains('u-hidden')) {
    const node = countdown.querySelector('.js-f95dlSeconds');
    const seconds = node ? parseInt(node.textContent, 10) : NaN;
    return snap({ dlActive: true, seconds: Number.isNaN(seconds) ? null : seconds });
  }
  const form = document.querySelector('form[action*="/dl/"]');
  if (!form) return snap();
  if (form.querySelector('${CAPTCHA_SELECTOR}')) return snap({ captcha: true });
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

// True once the page has been quiet for idleMs.
function shouldReveal({ settled = false, revealed = false, lastProgressAt }, now, idleMs = IDLE_REVEAL_MS) {
  if (settled || revealed) return false;
  return now - lastProgressAt >= idleMs;
}

module.exports = { DL_POLL_SCRIPT, shouldReveal, IDLE_REVEAL_MS, LOAD_GRACE_MS };
