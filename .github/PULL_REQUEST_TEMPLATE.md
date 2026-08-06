## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- Link the issue, or describe the broken behaviour. For a bug: what was the
     user-visible symptom, and what was the actual root cause? Those are often
     not the same thing, and the difference is the useful part. -->

## How it was tested

<!-- Name the test(s) you added and what they cover.
     For a fix, confirm the regression test FAILS without your change --
     if it passes before the fix, it isn't testing the fix. -->

- [ ] Added tests that cover this change
- [ ] For a fix: the regression test fails against the unfixed code
- [ ] `npm run check` passes locally
- [ ] New functions and IPC handlers have comments explaining *why*
- [ ] `CHANGELOG.md` updated
- [ ] This PR targets `nightly`, not `main`

## IPC changes

<!-- Delete this section if you touched no IPC.
     Otherwise: which channels were added, removed, or renamed? Confirm both
     sides moved together -- a handler with no caller, or a listener with no
     sender, passes review and does nothing. -->

## Anything the reviewer should know

<!-- Rejected approaches, known limitations, follow-up work, anything you're
     unsure about. "I'm not certain about X" is a useful thing to write here. -->
