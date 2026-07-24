# Gate 1 Android Chrome validation

Do not fill this worksheet from memory. Capture identity before trials and terminal diagnostics after each fresh-load run.

## Build and environment

- Exact Android device model: Pixel 8 Pro
- Android version: Android 16
- Android build: `CP1A.260505.005`
- Kernel: `6.1.145-android14-11-gfa1d6308d1fe-ab14691759` (`#1 Fri Jan 9 16:33:46 UTC 2026`)
- Chrome version: `150.0.7871.181`
- Commit SHA:
- Workflow URL:
- Served HTTPS URL:
- Workflow duration:
- Local verifier duration:
- Local Quick Start URL:
- README-to-Ready duration:
- Asset ID:
- Asset SHA-256:
- Calibration snapshot:
- Pre-trial identity snapshot:
- Post-calibration identity snapshot:
- Deployment frozen at:

## Preconditions

- [ ] `python3 scripts/verify_gate.py` reports `PASS gate 5/5`.
- [ ] The Pages run for Commit SHA completed successfully.
- [ ] Served HTML `build-commit` equals Commit SHA.
- [ ] Served module and asset requests return the expected content types and bytes.
- [ ] Ready Diagnostics match Commit SHA, Asset ID, Asset SHA-256, and Calibration snapshot.
- [ ] Any calibration change was verified, committed, redeployed, identity-checked, and smoked once.
- [ ] Deployments are frozen for all three trials.

## Trial 1 — complete playback

- Fresh reload timestamp:
- Ready timestamp:
- Run activation timestamp:
- Audible percussion present: yes / no
- Audible track present: yes / no
- Overlap present: yes / no
- Handoff sounds aligned: yes / no
- Audible glitch/stall/double-trigger: yes / no
- Terminal state:
- Accepted cause:
- `activeSourceCount`:
- `teardownSettled`:
- `finalContextState`:
- Build commit from terminal Diagnostics:
- Asset SHA-256 from terminal Diagnostics:
- Notes:

## Trial 2 — manual Stop

- Fresh reload timestamp:
- Ready timestamp:
- Run activation timestamp:
- Stop activation timestamp:
- Stop occurred during Running: yes / no
- Audible click or tail after stop: yes / no
- Terminal state:
- Accepted cause:
- `activeSourceCount`:
- `teardownSettled`:
- `finalContextState`:
- Build commit from terminal Diagnostics:
- Asset SHA-256 from terminal Diagnostics:
- Notes:

## Trial 3 — foreground interruption

- Fresh reload timestamp:
- Ready timestamp:
- Run activation timestamp:
- Foreground loss action and timestamp:
- Returned only after the original natural-end window: yes / no
- Audio restarted or resumed after return: yes / no
- Terminal state:
- Accepted cause:
- `activeSourceCount`:
- `teardownSettled`:
- `finalContextState`:
- Reloaded identity after trial:
- Build commit after reload:
- Asset SHA-256 after reload:
- Notes:

## Verdicts

### Technical verdict

PASS / STOP

Reason:

A technical PASS requires all three trials, matching immutable identity, no double start, true overlap, clean ownership teardown, no unintended resume, and terminal `activeSourceCount = 0`, `teardownSettled = true`, `finalContextState = closed`.

### Sonic scent verdict

PROMISING / NOT PROMISING / INCONCLUSIVE

Was there at least one perceptible moment where the controlled handoff felt naturally continuous rather than merely arithmetically aligned?

Reason:

### Product magic verdict

NOT TESTED IN MILESTONE 1

This gate does not test movement tapping, repeated in-workout locks, provider content, or workout usefulness. Do not infer those claims from a technical or sonic-scent result.
