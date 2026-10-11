# Milestone 2 — Task 14 Pixel Protocol Brief

Status: READY AFTER PR #4 MERGES AND DEPLOYS
Prepared: 2026-08-21

## What must happen before you start

1. Merge PR #4 (`feat/m2-one-track-root-staging`) to `main`. Only your merge deploys.
2. Wait for the exact merge commit's Pages deployment:
   ```bash
   SHA=$(git rev-parse origin/main)   # after your merge
   RUN_ID=$(gh run list --workflow deploy-pages.yml --branch main --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$RUN_ID" --exit-status
   ```
3. Publication preflight (operator machine), with `EXPECTED_SHA` = the merge SHA:
   ```bash
   EXPECTED_SHA="<merge-sha>"
   printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'
   IDENTITY=$(curl -fsS -H 'Cache-Control: no-cache' \
     "https://tonyisup.github.io/bpm-music-match/src/build-identity.mjs?v=$EXPECTED_SHA")
   ACTUAL_SHA=$(printf '%s\n' "$IDENTITY" | \
     python3 -c 'import re,sys; s=sys.stdin.read(); m=re.search(r"^export const BUILD_SHA = [\"\x27]([0-9a-f]{40})[\"\x27];$", s, re.M); print(m.group(1) if m else "")')
   test "$ACTUAL_SHA" = "$EXPECTED_SHA" && echo IDENTITY-OK
   ```
4. Optional deployed privacy smoke (plan Task 11 CLI; not yet implemented in this repo — skip if absent):
   `node scripts/one_track_browser_privacy_smoke.mjs --base-url https://tonyisup.github.io/bpm-music-match/ --expected-build <merge-sha>`

## Device and environment

- Pixel 8 Pro, Android 16 build `CP1A.260505.005`, Chrome `150.0.7871.181` (or a deliberately documented replacement).
- Close other audio, disable non-Gate-1 battery/audio effects, safe media volume, quiet stationary room, page foregrounded.
- Private MP3 stays on the phone. Select it only through the app's local picker. Never upload/send/commit it.

## The ten scored slots (fixed order, no reordering)

| Session | Slot | Thermal | Assigned class | Setup |
|---:|---:|---|---|---|
| 1 | 1 | Cold | CENTER | fresh tab `/?run=session-1`, select/validate track |
| 1 | 2 | Warmed | LOW_EDGE | Reset only after Slot 1 download; same buffer/context |
| 2 | 3 | Cold | HIGH_EDGE | fresh page `/?run=session-2` |
| 2 | 4 | Warmed | CENTER | Reset after Slot 3 download |
| 3 | 5 | Cold | LOW_EDGE | fresh page `/?run=session-3` |
| 3 | 6 | Warmed | HIGH_EDGE | Reset after Slot 5 download |
| 4 | 7 | Cold | CENTER | fresh page `/?run=session-4` |
| 4 | 8 | Warmed | LOW_EDGE | Reset after Slot 7 download |
| 5 | 9 | Cold | HIGH_EDGE | fresh page `/?run=session-5` |
| 5 | 10 | Warmed | CENTER | Reset after Slot 9 download |

Class windows (unrounded estimate): CENTER 109.25–110.75 · LOW_EDGE 107.00–107.75 · HIGH_EDGE 112.25–113.00 · APP MATCH 107.00–113.00.

Per-slot rules that decide PASS/FAIL:

- Slot begins at first accepted physical tap. Tap steadily; require one audible acknowledgment per tap; no Lock button.
- Up to two clean no-match retries; the third no-match is a scored technical failure.
- Any post-first-tap error, missing/double beat, click, gap, clipping, stale audio, ownership/teardown failure, wrong-class handoff, or reload = immediate scored failure for that slot.
- A class-valid handoff is the scored take whether it feels intentional or mechanical. Never replace it.
- Listen through beat 9 song-only; End trial only at/after beat 9.
- Before diagnostics: answer "Did the song feel hidden inside the taps?" (intentional / mechanical / not-judged) and record every defect boolean before Download enables.
- Download evidence BEFORE any Reset/reload. If evidence is lost, mark `evidence-missing`; never recreate.
- Cold destroyed session auto-fails its paired warmed slot as `paired-session-unavailable`.

## Two cancellation smokes (after all ten slots; failure = STOP)

1. `/?run=smoke-crossfade`: center handoff, tap once during beats 4–8. Require click-free stop, no delayed tail/doubled acknowledgment/stale restart, cancelling tap not reused. At visible ready, tap once → distinct generation + one normal acknowledgment → automatic probe cleanup → evidence-pending. Record five observations, Download, Reset.
2. `/?run=smoke-playing`: same but tap at/after beat 9.

## Acceptance

PASS requires ALL of: 10/10 technically complete; ≥8/10 intentional; one acknowledgment per tap through beat 9; no missing/doubled beat from last tap through beat 9; no clipping/click/gap/stale audio/leak; explicit edge-snap adjudication for LOW_EDGE/HIGH_EDGE; all evidence schema-valid on one build/asset/config; both smokes pass.

Validate a complete corpus from a private local directory of the sanitized downloads:
```bash
node scripts/validate_one_track_evidence.mjs --dir "$EVIDENCE_DIR"
# expect: VALID one-track-evidence scored=10 smokes=2 technical=<0..10> intentional=<0..10> decision=PASS|STOP
```

Early STOP (deployment/device/fixture/session-setup failure before a slot's first accepted tap): record only the closed operator code (`deployment-preflight` / `device-preflight` / `fixture-preflight` / `session-setup`) in the private worksheet. No validator run, no synthesized JSON, no mixing with a restart.

One bounded tuning cycle is available ONLY if the first complete protocol is technically valid but <8/10 intentional, and requires human approval; tuning creates a new config/build and restarts all ten slots.

## Recording the verdict

Final step (I can do this when you report results): write PASS or STOP plus build SHA/device/browser into `docs/validation/milestone-2-one-track-protocol.md`, commit as `docs: record milestone 2 Pixel verdict`.
