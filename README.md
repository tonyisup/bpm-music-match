# BPM Music Match

A narrow personal workout-music experiment. Milestone 1 is a disposable Android Chrome gate that answers one technical question: can one raw Web Audio graph start from a direct gesture, schedule phase-locked percussion, overlap into one controlled track, and release every source reliably?

This milestone is **not** product validation. It has no tap tempo, provider integration, catalog, account, playlist, or matcher. The separate `/enroll/` utility is a private-fixture bootstrap exception, not Milestone 2 product architecture. Follow the [private enrollment runbook](tools/m2-enrollment/README.md); never upload or send the MP3.

## Prerequisites

Use these exact runtimes:

- Python 3.13.7
- Node v22.22.3
- GitHub CLI authenticated to `tonyisup/bpm-music-match`

Check the live environment:

```bash
python3 --version
node --version
gh auth status
```

The verifier fails immediately if either runtime differs.

## Quick Start

From the repository root:

```bash
python3 scripts/verify_gate.py
python3 -m http.server 8000 --bind 127.0.0.1 --directory spikes/001-mobile-web-audio-gate
```

Open <http://127.0.0.1:8000/>. The page should move from **Loading test audio…** to **Ready**. Press **Run** once. A terminal result requires a page reload before another attempt.

For the measured developer-experience check, start a timer when this README is opened in a fresh clone or reopen. Stop it when the local page first shows **Ready**. Record the URL and README-to-Ready duration in the [validation worksheet](spikes/001-mobile-web-audio-gate/validation/gate-1.md).

Expected verifier shape:

```text
PASS runtime-version <duration>
PASS asset-integrity <duration>
PASS static-contract <duration>
PASS module-import <duration>
PASS node-tests <duration>
PASS enrollment-static-contract <duration>
PASS enrollment-module-import <duration>
PASS enrollment-node-tests <duration>
PASS enrollment-browser-privacy <duration>
PASS pages-staging <duration>
PASS gate 10/10 <total-duration>
```

The verifier is the sole local and CI gate. Individual commands below are debugging aids, not alternate verification workflows.

## First-time GitHub Pages setup

Run this idempotent block from a clean, verified `main` checkout:

```bash
gh auth status
git push -u origin main
gh repo edit tonyisup/bpm-music-match --default-branch main
if gh api repos/tonyisup/bpm-music-match/pages --jq .build_type > /tmp/bpm-pages-build-type 2>/dev/null; then
  if [ "$(cat /tmp/bpm-pages-build-type)" != "workflow" ]; then
    gh api --method PUT repos/tonyisup/bpm-music-match/pages -f build_type=workflow >/dev/null
  fi
else
  gh api --method POST repos/tonyisup/bpm-music-match/pages -f build_type=workflow >/dev/null
fi
test "$(gh api repos/tonyisup/bpm-music-match/pages --jq .build_type)" = "workflow"
```

A first-time GET may return 404; the block handles that by creating the site. An existing `legacy` site is updated. An existing `workflow` site is unchanged.

After pushing a deployable commit, wait for that exact commit:

```bash
SHA=$(git rev-parse HEAD)
RUN_ID=""
i=0
while [ "$i" -lt 30 ] && [ -z "$RUN_ID" ]; do
  RUN_ID=$(gh run list --workflow deploy-pages.yml --branch main --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$RUN_ID" ] || sleep 2
  i=$((i + 1))
done
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
```

The public Gate 1 URL is <https://tonyisup.github.io/bpm-music-match/>. It remains frozen to accepted Gate 1 commit `11df30f6f6cf90940bee425847614abaf26cc6f1`, even when a later deployment commit publishes it. Before every Gate 1 Android trial, expand **Diagnostics** at **Ready** and confirm that accepted identity.

The public enrollment bootstrap URL is <https://tonyisup.github.io/bpm-music-match/enroll/>. The candidate MP3 remains private and local; the URL itself is publicly reachable. Its HTML and every executed enrollment module identify the deploying main-branch commit and reject mixed cached builds. Do not use it until the exact reviewed deployment succeeds, and follow the [Private enrollment runbook](tools/m2-enrollment/README.md).

## Troubleshooting

Every verifier failure uses:

```text
FAIL <stage-id>: <problem>
CAUSE: <actual versus expected>
RERUN: <one exact command>
FIX: <one exact command or documentation anchor>
```

### `runtime-version`

Recheck `python3 --version` and `node --version`. Install or select Python 3.13.7 and Node v22.22.3, then rerun:

```bash
python3 scripts/verify_gate.py
```

### `asset-integrity`

Inspect the deterministic reproduction failure:

```bash
python3 -m unittest -v scripts/test_generate_gate_track.py
```

Regenerate only when the generator change is intentional:

```bash
python3 scripts/generate_gate_track.py
```

Then inspect and commit both the WAV and immutable metadata.

### `static-contract`

```bash
python3 -m unittest -v scripts/test_static_contract.py scripts/test_verify_gate.py
```

Fix the named HTML, CSS, workflow, documentation, or verifier contract. Do not bypass the contract in CI.

### `module-import`

```bash
node --input-type=module --eval "await import('./spikes/001-mobile-web-audio-gate/app.mjs')"
```

Fix the named relative `.mjs` import. The browser and Node use the same modules.

### `node-tests`

```bash
node --test spikes/001-mobile-web-audio-gate/tests/*.test.mjs
```

Run the named failing test in isolation before changing implementation.

### Enrollment and Pages stages

- `enrollment-static-contract`: rerun `python3 -m unittest -v scripts/test_enrollment_static_contract.py`.
- `enrollment-module-import`: rerun the exact command emitted on the `RERUN:` line. The current command is:

  ```bash
  node --input-type=module --eval 'await Promise.all([import("./tools/m2-enrollment/app.mjs"),import("./tools/m2-enrollment/enrollment-build.mjs"),import("./tools/m2-enrollment/enrollment-browser-load.mjs"),import("./tools/m2-enrollment/enrollment-browser-preview.mjs"),import("./tools/m2-enrollment/enrollment-browser-resources.mjs"),import("./tools/m2-enrollment/enrollment-browser-shared.mjs"),import("./tools/m2-enrollment/enrollment-browser.mjs"),import("./tools/m2-enrollment/enrollment-config.mjs"),import("./tools/m2-enrollment/enrollment-core.mjs"),import("./tools/m2-enrollment/enrollment-lifecycle.mjs"),import("./tools/m2-enrollment/enrollment-measurements.mjs"),import("./tools/m2-enrollment/enrollment-report.mjs")]);'
  ```
- `enrollment-node-tests`: rerun `node --test scripts/enrollment-download-artifacts.test.mjs tools/m2-enrollment/tests/*.test.mjs`.
- `enrollment-browser-privacy`: rerun `node scripts/enrollment_browser_privacy_smoke.mjs` with a supported installed Chrome.
- `pages-staging`: rerun `python3 -m unittest -v scripts/test_stage_pages.py` and fix the named manifest, allowlist, identity, or publication assertion.

These are unified-gate debugging commands. The release decision still comes only from `python3 scripts/verify_gate.py`.

### Browser error codes

- `asset-fetch-failed`: an asset request failed; check the server/HTTPS origin and network.
- `metadata-invalid`: immutable metadata or the single calibration record is malformed.
- `asset-integrity-failed`: fetched WAV bytes do not match the committed SHA-256.
- `module-identity-failed`: staged HTML and the three executed runtime modules do not embed the same full commit SHA; wait for the exact deployment or clear stale site data, then reload.
- `decode-failed`: the owned audio context could not decode or validate the WAV.
- `load-timeout`: loading exceeded the bounded deadline.
- `resume-failed`: Chrome rejected or failed to enter the running context state.
- `startup-timeout`: the gesture-started context did not become running before the watchdog.
- `schedule-failed`: graph construction or source scheduling rolled back transactionally.
- `context-close-failed`: source ownership cleared but the owned context rejected close; preserve the first terminal result, record Diagnostics, and fail the trial.

Browser details are intentionally not shown in the user-visible error copy. Use terminal Diagnostics after the run and Chrome remote debugging when needed.

## Experiment docs

- [Approved design](docs/design/approved-design.md)
- [Approved implementation plan](docs/plans/2026-07-24-milestone-1-mobile-audio-gate.md)
- [Spike contract and calibration runbook](spikes/001-mobile-web-audio-gate/README.md)
- [Android validation worksheet](spikes/001-mobile-web-audio-gate/validation/gate-1.md)
- [Milestone 2 one-track design](docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md)
- [Milestone 2 enrollment bootstrap plan](docs/plans/2026-07-25-milestone-2-enrollment-bootstrap.md)
- [Private enrollment runbook](tools/m2-enrollment/README.md)
