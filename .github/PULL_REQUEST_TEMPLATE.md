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

## AI assistance

<!-- Required. Tick exactly ONE box. CI checks that you answered.

     Not a rule against using AI - plenty of Atlas was written with it. The
     reviewer needs to know WHICH one, because different assistants fail in
     different, predictable ways and knowing the tool says what to check first.
     See CONTRIBUTING.md rule 5. -->

- [ ] No AI was used on this change
- [ ] AI was used on this change

<!-- If you ticked "AI was used", fill in all three lines below.
     Delete them if you ticked "No AI". -->

**Tool and model:** <!-- e.g. "Claude Opus 5 via Claude Code", "GitHub Copilot",
                         "Cursor with GPT-5", "ChatGPT, pasted by hand" -->

**What it wrote:** <!-- Be specific. "All of electron/downloads/hosts/foo.js and
                       its tests" or "the retry loop in startTransfer only".
                       "Some of it" tells the reviewer nothing. -->

**What you verified yourself:** <!-- What you actually ran, read or checked by
                                    hand. Which claims you confirmed rather than
                                    took on trust. If an assistant told you a
                                    test passes, say whether you watched it. -->

## IPC changes

<!-- Delete this section if you touched no IPC.
     Otherwise: which channels were added, removed, or renamed? Confirm both
     sides moved together -- a handler with no caller, or a listener with no
     sender, passes review and does nothing. -->

## Anything the reviewer should know

<!-- Rejected approaches, known limitations, follow-up work, anything you're
     unsure about. "I'm not certain about X" is a useful thing to write here. -->
