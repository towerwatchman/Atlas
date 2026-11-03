# Legacy tag history

Nightly tags before 0.9.14 cannot be trusted to name the release they fed. This
file records what happened, so [CHANGELOG.md](./CHANGELOG.md) and
[NIGHTLY.CHANGELOG.md](./NIGHTLY.CHANGELOG.md) can link here instead of
repeating it.

## How a build was named

`.github/workflows/nightly.yml` names a build from `package.json`:

    base=$(node -p "require('./package.json').version")
    version="${base}-nightly.${run_number}"

The counter is the workflow run number: global, never reset. The prefix is
whatever `package.json` held on the branch that built it. The file was bumped
near the release rather than at the start of the cycle, so the development
builds of a cycle carry the previous release's number.

## Builds per release

A stable is cut from the last nightly that is an ancestor of its tag. The
nightly log entries for that row are what the stable summarises, whatever the
labels say.

| Stable | Released | Cut from | Nightlies since the previous release |
|---|---|---|---|
| 0.9.0 | 2026-07-07 | `.325` | `.110` to `.324` are the imported `0.1.0` line; `.325` carries `0.9.0` |
| 0.9.1 | 2026-07-07 | `.338` | `.326` and `.330` to `.337` carry `0.9.0`; `.327` to `.329` carry `0.1.0`; `.338` carries `0.9.1` |
| 0.9.2 | 2026-07-13 | `.343` | `.339` to `.342` carry `0.9.1`; `.343` carries `0.9.2` |
| 0.9.3 | 2026-07-23 | `.361` | `.344` to `.360` carry `0.9.2`; `.361` carries `0.9.3` |
| 0.9.4 | 2026-07-24 | `.378` | `.362` to `.369` carry `0.9.3`; `.378` carries `0.9.4` and retags the tag commit |
| 0.9.5 | 2026-07-24 | `.379` | `.378` carries `0.9.4`; `.379` carries `0.9.5` |
| 0.9.6 | 2026-07-26 | `.385` | `.380` to `.384` carry `0.9.5`; `.385` carries `0.9.6` |
| 0.9.7 | 2026-07-28 | `.394` | `.386` to `.392` carry `0.9.6`; `.393` retags that build under `0.9.7`; `.394` carries `0.9.7` |
| 0.9.8 | 2026-07-31 | `.415` | `.395` to `.414` carry `0.9.7`, except `.404` which carries `0.9.6`; `.415` carries `0.9.8` |
| 0.9.9 | 2026-08-11 | `.456` | `.416` to `.430` retag the `0.9.8` commit and `.430` carries `0.9.9`; `.431` to `.456` carry `0.9.8` |
| 0.9.10 | 2026-09-30 | `.502` | `.459` to `.501` carry `0.9.9`; `.502` carries `0.9.10` |
| 0.9.11 | 2026-10-16 | PR #451 | `.503` to `.511` carry `0.9.10` and are not in the tag; the tag is a main bump |
| 0.9.12 | 2026-10-18 | PR #452 | no nightly contains it; the tag is a hotfix merge |
| 0.9.13 | open | none yet | `.512` to `.517` carry `0.9.12` |

## Reading it

- Through 0.9.8 the tag sits on the candidate commit, so the stable tag and a
  nightly tag share it. From 0.9.9 the tag is a bump or merge commit, and the
  candidate is the last nightly before it.
- The label changes at the end of a cycle, not at the start. `.344` to `.360`
  carry `0.9.2` and feed 0.9.3; `.459` to `.501` carry `0.9.9` and feed 0.9.10.
- `.393` carries the `0.9.7` prefix on the `0.9.6` commit, a wrong-prefix
  retag like `.430`.
- Most cycles end with a retag cluster on one commit: `.330` to `.337` (8
  tags), `.361` to `.369` (9), `.379` to `.384` (6), `.385` to `.392` (8),
  `.398` to `.414` (16, including `.404`), `.415` to `.430` (16, including
  `.430`), `.431` to `.437` (7).
- `.370` to `.377`, `.400`, `.457` and `.458` were never built.
- Some tags were deleted while their releases remain: `.418`, `.455`, `.462`,
  `.482`, `.489`, `.490`, `.495` to `.500`.

## Not a timeline

The GitHub tags page sorts by name and shows commit dates, so its order is not
build order. Release publish times are closer but still batched: the `.415` to
`.429` releases were created together on 2026-07-31 and published through
August 4.

## Going forward

From the cycle after 0.9.13, bump `package.json` to the next release as soon as
the previous one ships, before the first nightly of the new cycle. Builds then
carry `{next}-nightly.<counter>`, the counter keeps running, and the release is
cut by merging to `main`. After that release, bump again for the next cycle.

0.9.13 ships as it is set up now, with its builds under the `0.9.12` label. The
first build under the new rule is `0.9.14-nightly.518`.
