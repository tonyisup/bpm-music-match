# Gate 1 Android Chrome validation

Do not fill this worksheet from memory. Capture identity before trials and terminal diagnostics after each fresh-load run.

## Build and environment

- Exact Android device model: Pixel 8 Pro
- Android version: Android 16
- Android build: `CP1A.260505.005`
- Kernel: `6.1.145-android14-11-gfa1d6308d1fe-ab14691759` (`#1 Fri Jan 9 16:33:46 UTC 2026`)
- Chrome version: `150.0.7871.181`
- Commit SHA: `11df30f6f6cf90940bee425847614abaf26cc6f1`
- Workflow URL: https://github.com/tonyisup/bpm-music-match/actions/runs/30118671706
- Served HTTPS URL: https://tonyisup.github.io/bpm-music-match/?verify=11df30f6f6cf90940bee425847614abaf26cc6f1
- Workflow duration: 42 seconds
- Local verifier duration: 1.22 seconds (`PASS gate 5/5`)
- Local Quick Start URL: `http://127.0.0.1:8000/`
- README-to-Ready duration: not instrumented; non-acceptance DevEx field
- Asset ID: `gate-track-v1`
- Asset SHA-256: `d8be8fdd4f5f1d3222c5df86f15fb509d1844c40b40450fc738f2bef812d0033`
- Calibration snapshot: `{"trackTrim":0.7,"percussionTrim":0.35,"masterGain":0.8}`
- Pre-trial identity snapshot: Ready identity captured for Trial 2; Trial 1 and Trial 3 terminal identities matched the same immutable build
- Post-calibration identity snapshot: commit, asset ID, asset SHA-256, and calibration unchanged across calibration and all three formal trials
- Deployment frozen at: `2026-07-24T19:05:04Z`
- Browser UA diagnostic: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36` (reduced UA; authoritative OS/browser versions are recorded above)

## Calibration and complete-trial evidence

### Calibration run — reported 50% media volume

- Session started: `2026-07-24T19:00:01.779Z`
- Load-to-Ready: `972.2999999821186` ms
- Context sample rate: `48000`
- Terminal state / cause: `complete` / `natural-end`
- Beat one / crossfade start / crossfade end / natural end audio times: `0.1` / `2.1` / `4.1` / `16.1`
- Scheduled / ended percussion: `8` / `8`
- Track ended: `true`
- Active source count: `0`
- Teardown settled: `true`
- Final context state: `closed`
- Error code: `none`
- Evidence: `evidence/calibration-50-complete.png`

### Calibration decision

- Reported loudness: not too loud at either 50% or 100% media volume.
- Reported percussion and handoff: good.
- Trim decision: unchanged; retain `trackTrim=0.7`, `percussionTrim=0.35`, `masterGain=0.8`.
- Deployment decision: freeze commit `11df30f6f6cf90940bee425847614abaf26cc6f1` for the three formal acceptance trials.

## Preconditions

- [x] `python3 scripts/verify_gate.py` reports `PASS gate 5/5`.
- [x] The Pages run for Commit SHA completed successfully.
- [x] Served HTML `build-commit` equals Commit SHA.
- [x] Served module and asset requests return the expected content types and bytes.
- [x] Calibration Diagnostics match Commit SHA, Asset ID, Asset SHA-256, and Calibration snapshot.
- [x] No calibration change was required; the verified deployed identity remains unchanged.
- [x] Deployments are frozen for all three trials.

## Trial 1 — complete playback

- Fresh reload/session timestamp: `2026-07-24T19:03:05.878Z`
- Ready timestamp: not separately captured; Load-to-Ready was `295.80000001192093` ms
- Run activation timestamp: not captured
- Media volume: 100%
- Audible percussion present: yes
- Audible track present: yes
- Overlap present: yes
- Handoff sounds aligned: yes; reported good
- Audible glitch/stall/gap/double-trigger: no
- Terminal state: `complete`
- Accepted cause: `natural-end`
- Context sample rate: `48000`
- Beat one / crossfade start / crossfade end / natural end audio times: `0.58` / `2.58` / `4.58` / `16.58`
- Scheduled / ended percussion: `8` / `8`
- Track ended: `true`
- `activeSourceCount`: `0`
- `teardownSettled`: `true`
- `finalContextState`: `closed`
- Error code: `none`
- Build commit from terminal Diagnostics: `11df30f6f6cf90940bee425847614abaf26cc6f1`
- Asset SHA-256 from terminal Diagnostics: `d8be8fdd4f5f1d3222c5df86f15fb509d1844c40b40450fc738f2bef812d0033`
- Evidence: `evidence/trial-1-complete.png`
- Notes: Originally the second unchanged-calibration run, then designated Trial 1 after explicit confirmation of track audibility, genuine overlap, and no glitch/stall/gap/double-trigger. Identity was captured terminally rather than as a separate Ready screenshot; no deploy or calibration change occurred between the calibration run and this trial.

## Trial 2 — manual Stop

- Fresh reload/session timestamp: `2026-07-24T19:28:24.810Z`
- Ready timestamp: not separately timestamped; Load-to-Ready was `474.60000002384186` ms
- Ready identity captured before Run: yes
- Run activation timestamp: not captured
- Stop activation timestamp: not captured
- Stop occurred during Running: yes
- Audible click: no
- Abrupt volume jump: no
- Audible tail after Stop: no
- Terminal state: `stopped`
- Accepted cause: `manual-stop`
- Context sample rate: `48000`
- Beat one / crossfade start / crossfade end / natural end audio times: `1.1213333333333335` / `3.1213333333333333` / `5.121333333333333` / `17.121333333333332`
- Scheduled / ended percussion: `8` / `8`
- Track ended: `true`
- `activeSourceCount`: `0`
- `teardownSettled`: `true`
- `finalContextState`: `closed`
- Error code: `none`
- Build commit from Ready and terminal Diagnostics: `11df30f6f6cf90940bee425847614abaf26cc6f1`
- Asset SHA-256 from Ready and terminal Diagnostics: `d8be8fdd4f5f1d3222c5df86f15fb509d1844c40b40450fc738f2bef812d0033`
- Calibration from Ready Diagnostics: `trackTrim=0.7`, `percussionTrim=0.35`, `masterGain=0.8`
- Evidence: `evidence/trial-2-ready.png`, `evidence/trial-2-stopped.png`
- Notes: User reported no click, abrupt volume change, or audio tail. Browser UA remained the reduced Chrome 150 mobile identity recorded above.

## Trial 3 — foreground interruption

- Fresh reload/session timestamp: `2026-07-24T19:32:39.477Z`
- Ready timestamp: not separately timestamped; Load-to-Ready was `400.5999999403954` ms
- Run activation timestamp: not captured
- Foreground loss action and timestamp: Android foreground loss; exact activation timestamp not captured
- Returned only after the original natural-end window: yes
- Audio restarted or resumed after return: no
- Delayed audio tail after return: no
- Terminal state: `interrupted`
- Accepted cause: `hidden`
- Context sample rate: `48000`
- Beat one / crossfade start / crossfade end / natural end audio times: `0.1` / `2.1` / `4.1` / `16.1`
- Scheduled / ended percussion: `8` / `8`
- Track ended: `false`
- `activeSourceCount`: `0`
- `teardownSettled`: `true`
- `finalContextState`: `closed`
- Error code: `none`
- Reloaded identity after trial: user supplied a Ready screenshot with unchanged build, asset, and calibration; the PNG is pixel-identical to the Trial 2 Ready screenshot and contains no independent capture timestamp
- Build commit after reload: `11df30f6f6cf90940bee425847614abaf26cc6f1`
- Asset ID / SHA-256 after reload: `gate-track-v1` / `d8be8fdd4f5f1d3222c5df86f15fb509d1844c40b40450fc738f2bef812d0033`
- Calibration after reload: `trackTrim=0.7`, `percussionTrim=0.35`, `masterGain=0.8`
- Evidence: `evidence/trial-3-interrupted.png`, `evidence/trial-3-reloaded-ready.png`
- Notes: User confirmed audio did not resume, did not restart, and produced no delayed tail after return. The typed `hidden` cause won first-terminal-cause ownership; track natural completion did not occur. The post-trial Ready claim relies on the user's supplied context because the static Ready screenshot itself has no timestamp and is byte-identical to the prior Ready evidence.

## Verdicts

### Technical verdict

PASS

Reason: All three Android Chrome trials used the same immutable build, asset, and calibration. Complete playback demonstrated audible percussion, audible track, genuine overlap, an aligned handoff, and no glitch/stall/gap/double-trigger. Manual Stop produced no click, abrupt volume jump, or tail. Foreground loss terminated with typed cause `hidden`; audio did not resume, restart, or emit a delayed tail. Every terminal path reported `activeSourceCount = 0`, `teardownSettled = true`, `finalContextState = closed`, and `error code = none`.

A technical PASS requires all three trials, matching immutable identity, no double start, true overlap, clean ownership teardown, no unintended resume, and terminal `activeSourceCount = 0`, `teardownSettled = true`, `finalContextState = closed`.

### Sonic scent verdict

PROMISING

Was there at least one perceptible moment where the controlled handoff felt naturally continuous rather than merely arithmetically aligned?

Reason: The user reported good percussion and handoff quality, clear track audibility, genuine overlap, no excessive loudness at 50% or 100% media volume, and no audible artifacts on manual Stop. This supports a naturally continuous controlled handoff, while remaining deliberately short of a product-usefulness claim.

### Product magic verdict

NOT TESTED IN MILESTONE 1

This gate does not test movement tapping, repeated in-workout locks, provider content, or workout usefulness. Do not infer those claims from a technical or sonic-scent result.

## Gate decision

- Adjudicated at: `2026-07-24T19:39:13Z`
- Gate 1: **PASS**
- Milestone 2: **UNBLOCKED for the next controlled product-hypothesis milestone**
- Scope boundary: provider integration, movement tapping, repeated workout locks, and workout usefulness remain unvalidated.
