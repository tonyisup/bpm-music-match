<!-- /autoplan restore point: /Users/juicebox/.gstack/projects/bpm-music-match/main-autoplan-restore-20260724-090046.md -->
# BPM Music Match Milestone 1: Android Chrome Audio-Control Spike

**Status:** APPROVED FOR IMPLEMENTATION
**Product-intent source of truth:** `docs/design/approved-design.md`; this milestone plan supersedes its Gate 1 lifecycle/recovery mechanics where explicitly noted
**Repository:** `https://github.com/tonyisup/bpm-music-match`
**Expected deployment:** `https://tonyisup.github.io/bpm-music-match/`
**Acceptance target:** Android phone using Chrome

> Implement Milestone 1 only. This is a disposable feasibility spike, not the product architecture. Milestone 2 remains blocked until three deployed Android Chrome trials pass.

## Goal

Build the smallest honest deployed experiment that can answer:

> Can Android Chrome, after one direct user gesture, run one app-owned raw Web Audio graph that schedules percussion and a controlled music-like asset, overlaps them through independent gain paths, completes an audible equal-power handoff, and cancels cleanly on interruption?

Milestone 1 does **not** test tap estimation, cadence lock, workout usability, product differentiation, matching, or provider feasibility.

## Locked decisions

| Decision | Locked value | Why |
|---|---|---|
| Audio ownership | One native `AudioContext` owns percussion and track paths | Preserves the true overlapping crossfade |
| Acceptance browser | Android Chrome | User-selected gate target |
| Hosting | Public `tonyisup/bpm-music-match` repository with GitHub Pages | Provides a reproducible HTTPS origin |
| Acceptance stimulus | Original deterministic 120 BPM loop generated for this repository | Removes licensing, codec, downbeat, duration, and loudness variance |
| Track entry | Asset starts at offset `0`; annotated target entry downbeat is `2.0s` | Four 120 BPM lead-in beats place beat 5 at the crossfade start |
| Scope posture | Spike first; harden only after deployed smoke succeeds | Tests the existential browser risk before building architecture around it |
| Later field gate | One workout with at least three movement changes after Milestone 2 | Tests repeated cadence reseeding before catalog replication |
| Provider work | After the real-workout field gate | Controlled-audio value must exist before distribution-policy work resumes |

## Hypothesis ledger

The final spike report must print all three verdicts separately:

```text
TECHNICAL AUDIO GATE: PASS | PARTIAL | FAIL | BLOCKED
IDEAL-CONDITION SONIC CHECK: intentional | mechanical | not-run   (non-gating)
PRODUCT MAGIC: NOT TESTED UNTIL MILESTONE 2
```

A technical PASS must never be described as validation of the interaction, differentiation, or product premise.

## NOT in scope

- Tap input, cadence estimation, silence lock, or predicted beat scheduling
- Track matching, BPM discovery, half/double-time behavior, or catalog work
- YouTube, Spotify, Apple Music, or any provider integration
- Backend, accounts, analytics, storage, uploads, PWA, or background playback
- A reusable audio framework or published package
- More than one bundled acceptance asset
- A general file picker or support for arbitrary audio in Gate 1
- Normalization, limiting, or adaptive level balancing
- Milestone 2 perceptual trials

## Spike decomposition

| # | Spike | Given / When / Then | Risk |
|---|---|---|---|
| 001A | HTTPS one-gesture overlap | Given the deployed page and decoded canonical asset, when Run is pressed once, then Android Chrome resumes the context and audibly executes percussion-only → overlap → music-only without another gesture | Existential |
| 001B | Interruption teardown | Given an active or scheduled run, when Stop, backgrounding, or context interruption occurs, then owned sources and automation stop without stale completion or audible residue | High |
| 001C | Repeatability | Given one frozen asset and gain calibration, when three fresh deployed trials run, then every required observation passes without changing code or levels | High |

Run in that order. Failure of 001A stops 001B and 001C.

## Repository layout

```text
bpm-music-match/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy-pages.yml
├── docs/
│   ├── design/approved-design.md
│   ├── plans/2026-07-24-milestone-1-mobile-audio-gate.md
│   └── validation/mobile-audio-gate.md
├── scripts/
│   ├── generate_gate_track.py
│   ├── test_generate_gate_track.py
│   ├── test_static_contract.py
│   └── verify_gate.py
└── spikes/001-mobile-web-audio-gate/
    ├── README.md
    ├── index.html
    ├── styles.css
    ├── app.mjs
    ├── audio-engine.mjs
    ├── audio-math.mjs
    ├── asset-metadata.json
    ├── calibration.json
    ├── ASSET-LICENSE.md
    ├── assets/gate-track.wav
    └── tests/
        ├── app.test.mjs
        ├── audio-engine.test.mjs
        ├── audio-math.test.mjs
        └── fake-audio.mjs
```

No npm dependency or bundler is required for the spike. Node's built-in test runner covers pure logic and fake-node contracts. The browser runs native ES modules and Web Audio directly. If the spike passes, the real Milestone 2 app may choose a production scaffold separately; do not preserve spike structure merely because it exists.

---

## Phase A: Prove the deployed browser path

### Task A0: Lock and verify prerequisites

**Files:** Modify this plan only if reality differs.

1. Verify the Git remote is exactly `https://github.com/tonyisup/bpm-music-match.git`.
2. Verify repository visibility is public.
3. Push `main`, verify `origin/main` exists, and set/confirm the GitHub default branch is `main`; the empty remote and missing default branch are not treated as configured deployment.
4. Record the expected Pages URL: `https://tonyisup.github.io/bpm-music-match/` and explicitly configure Pages to use GitHub Actions.
5. Record acceptance target as Android + Chrome; the final worksheet must add the actual phone, Android version, and Chrome version.
6. Verify local Python `3.13.7` and Node `22.22.3`; CI must provision those exact versions.
7. Do not write runtime code until checks 1–6 are true.

The root README and Task A0 use one tested idempotent first-time Pages block. The current expected initial state is authenticated/public with Pages GET returning 404; after the first push the block must also succeed when already configured:

```bash
gh auth status
git push -u origin main
gh repo edit tonyisup/bpm-music-match --default-branch main

if gh api repos/tonyisup/bpm-music-match/pages --jq .build_type >/tmp/bpm-pages-build-type 2>/dev/null; then
  if [ "$(</tmp/bpm-pages-build-type)" != "workflow" ]; then
    gh api --method PUT repos/tonyisup/bpm-music-match/pages -f build_type=workflow >/dev/null
  fi
else
  gh api --method POST repos/tonyisup/bpm-music-match/pages -f build_type=workflow >/dev/null
fi

test "$(gh api repos/tonyisup/bpm-music-match/pages --jq .build_type)" = "workflow"
rm -f /tmp/bpm-pages-build-type
```

Document expected outcomes: auth/public/default-branch checks must succeed; a first-run Pages 404 is rescued by POST; an existing non-workflow site is updated; an already configured workflow site is unchanged. Any other API/auth failure stops before runtime work.

**Verify:**

```bash
git remote get-url origin
gh repo view tonyisup/bpm-music-match --json visibility,url,defaultBranchRef
python3 --version
node --version
```

### Task A1: Generate and document the canonical asset

**Files:**
- Create `scripts/generate_gate_track.py`
- Create `scripts/test_generate_gate_track.py`
- Create `scripts/test_static_contract.py`
- Create `spikes/001-mobile-web-audio-gate/assets/gate-track.wav`
- Create `spikes/001-mobile-web-audio-gate/asset-metadata.json`
- Create `spikes/001-mobile-web-audio-gate/calibration.json`
- Create `spikes/001-mobile-web-audio-gate/ASSET-LICENSE.md`

Write a Python-standard-library generator. It must use no third-party samples or packages.

The generator accepts an explicit `--output-dir`. Synthesis is integer/fixed-point using a checked-in integer wavetable or equivalent deterministic table with explicit rounding, clipping, little-endian PCM16 packing, and no platform `libm` dependency in sample generation.

Asset contract:

```json
{
  "id": "gate-track-v1",
  "bpm": 120,
  "sampleRate": 44100,
  "channels": 2,
  "durationSeconds": 16,
  "targetEntryDownbeatSeconds": 2.0,
  "postCrossfadeTailSeconds": 2.0,
  "generator": "scripts/generate_gate_track.py",
  "sha256": "computed-after-generation"
}
```

Musical requirements:

- Exactly 120 BPM and quantized to a 0.5-second beat grid.
- Beat 5 at `2.0s` is an unambiguous downbeat with stronger kick/bass/chord onset than surrounding beats.
- The first four beats form a lead-in; the asset continues at least two seconds beyond crossfade completion.
- Use original synthesized kick, hat, bass, and simple chord voices only.
- Peak absolute sample value is at most `0.80` before runtime trims.
- Generation is deterministic: two runs produce the same SHA-256.
- Tests assert every voice onset lies on the declared subdivision grid, beat 5 has the intended stronger event set, and no off-grid voice start exists.
- `ASSET-LICENSE.md` states that the asset was generated for this repository with no third-party samples and is dedicated under CC0-1.0.

**TDD/verification:** Write `scripts/test_generate_gate_track.py` first. It regenerates into a temporary directory, parses the temporary WAV, asserts sample rate, channel count, duration, frame count, peak bound, event/onset grid, beat-5 emphasis, and immutable metadata, then byte-compares it with the committed WAV and stored SHA-256. CI never overwrites the committed asset. `asset-metadata.json` contains generated immutable facts only; frozen runtime trims live separately in `calibration.json` so calibration cannot invalidate regeneration.

```bash
python3 scripts/generate_gate_track.py
shasum -a 256 spikes/001-mobile-web-audio-gate/assets/gate-track.wav
python3 -m unittest scripts/test_generate_gate_track.py
```

### Task A2: Test pure timing and equal-power math

**Files:**
- Create `spikes/001-mobile-web-audio-gate/audio-math.mjs`
- Create `spikes/001-mobile-web-audio-gate/tests/audio-math.test.mjs`

Write failing Node tests first for:

- Equal-power arrays begin/end at `(music, percussion) = (0,1)` and `(1,0)`.
- `music² + percussion² ≈ 1` at every sample.
- Curves are `Float32Array` values with exactly 128 samples, finite and monotonic, generated once per run; length below 2 fails loudly.
- Invalid sample counts fail loudly.
- Fixed 120 BPM plan uses `beatDuration = 0.5s`.
- Beat 1 occurs `0.1s` after `audioNow`.
- Eight percussion beat times are scheduled.
- Track begins at beat 1, offset `0`.
- Crossfade begins at beat 5, which coincides with asset time `2.0s`.
- Crossfade ends at the beat-9 boundary.
- Asset duration covers transition completion plus a two-second tail.
- Non-finite or non-positive timing inputs fail loudly.

Then implement only enough pure code to pass.

```bash
node --test spikes/001-mobile-web-audio-gate/tests/audio-math.test.mjs
```

### Task A3: Build the minimal interactive HTTPS spike

**Files:**
- Create `spikes/001-mobile-web-audio-gate/index.html`
- Create `spikes/001-mobile-web-audio-gate/styles.css`
- Create `spikes/001-mobile-web-audio-gate/app.mjs`
- Create `spikes/001-mobile-web-audio-gate/audio-engine.mjs`
- Create `spikes/001-mobile-web-audio-gate/tests/app.test.mjs`
- Create `spikes/001-mobile-web-audio-gate/tests/fake-audio.mjs`
- Create `spikes/001-mobile-web-audio-gate/tests/audio-engine.test.mjs`
- Create `spikes/001-mobile-web-audio-gate/README.md`
- Create `scripts/verify_gate.py`
- Modify `README.md`

This is intentionally one narrow browser path, not the final architecture.

`app.mjs` exports pure UI transition and button-model functions plus a dependency-injected loader accepting `fetch`, `decode`, `digest`, clock, and timeout adapters. DOM setup lives in an explicit `main()` that runs only when the browser entrypoint invokes it; importing every `.mjs` file in Node must not access `document`, construct an `AudioContext`, or create side effects. `tests/app.test.mjs` exhaustively covers legal/illegal transitions, `freshLoadEligible`, primary/Stop models, atomic double activation, terminal Reload, timeout, non-200, invalid metadata, hash mismatch, decode rejection, late completion, and success.

`scripts/test_static_contract.py` uses only `html.parser` to assert the required h1, primary and Stop slots, diagnostics semantics, commit meta placeholder, module entrypoint, relative URLs, viewport zoom support, and absence of file inputs. This is a static contract check, not rendered-browser proof.

`scripts/verify_gate.py` is the sole dependency-free local/CI gate. Both workflows call only this entrypoint after provisioning runtimes; raw test commands are debugging aids, not separate gate definitions. It checks for exactly Python `3.13.7` and Node `22.22.3`, executes these ordered stage IDs, and stops on first failure:

1. `runtime`
2. `asset`
3. `static-contract`
4. `module-import`
5. `node-tests`

Success format is deterministic: one `PASS <stage>` line per stage, then `PASS gate: 5/5 stages in <seconds>s`. Failure format is exactly:

```text
FAIL <stage>: <problem>
CAUSE: expected=<safe value>; actual=<safe value>
RERUN: <supported standalone command>
FIX: <exact command or README anchor>
```

Supported reruns use only declared surfaces, including `python3 -m unittest -v scripts/test_generate_gate_track.py`, `python3 -m unittest -v scripts/test_static_contract.py`, `node --test spikes/001-mobile-web-audio-gate/tests/*.test.mjs`, and `python3 scripts/generate_gate_track.py --output-dir /tmp/bpm-gate-debug`. Runtime-manager-specific setup lives under `README.md#prerequisites`. The verifier prints total elapsed time, exits nonzero on the first failed gate, and never generates or overwrites the committed asset.

The root `README.md` owns a three-step Quick Start with expected output and time budgets: run `python3 scripts/verify_gate.py`; run `python3 -m http.server --bind 127.0.0.1 --directory spikes/001-mobile-web-audio-gate 8000` and leave it running; open `http://127.0.0.1:8000/`, then stop the server with Ctrl-C. It also owns first-time Pages setup/deploy/status commands. The spike README owns architecture, calibration procedure/link, diagnostics, typed error reference, smoke procedure, identity-recording steps, and Android acceptance. Each links to the other; neither duplicates the full plan.

Required flow:

```text
LOAD ──decode bundled WAV──▶ READY
                              │
                       one Run press
                              ▼
                       RESUME + SCHEDULE
                              │
          percussion-only ──▶ overlap ──▶ music-only
                              │
                    complete or cancel
                              ▼
                       READY / RESULT
```

Screen hierarchy is fixed:

```text
┌──────────────────────────────────────────┐
│ Android audio gate                      │  h1: what this screen is
│ Technical test. No tapping or matching. │  one-line truth boundary
│ Set media volume. Keep page foreground. │  neutral pre-run instruction
│                                          │
│ Status: Ready                            │  primary orientation
│ [ RUN AUDIO GATE ]                       │  only primary action
│ [ Stop ]                                 │  fixed slot; enabled while starting/running
│                                          │
│ Trial result / recovery action           │  completion or error
│ ▸ Diagnostics                            │  collapsed by default
└──────────────────────────────────────────┘
```

Main-screen priority is: **status → action → result/recovery**. The scope note orients but never competes with Run. There is no navigation, brand treatment, hero, card grid, phase animation, waveform, album art, progress bar, or decorative audio visualization.

Pre-run copy is exact: **“Set media volume before Run. Keep this page foregrounded. Listen without watching; record what you heard before opening diagnostics.”**

UI state and button contract:

| UI state | User sees | Primary slot | Stop slot | Diagnostics |
|---|---|---:|---:|---|
| `loading` | “Loading test audio…” from first paint | Run disabled | Visually hidden + disabled | Collapsed; load stage available |
| `load-error` | Specific fetch/decode cause | **Reload page** | Visually hidden + disabled | Frozen typed code visible |
| `ready` | “Ready. One press should start the full test.” | **Run audio gate** | Visually hidden + disabled | Collapsed |
| `starting` | “Starting audio…” while `resume()` is pending and schedule is being created | Run disabled | Enabled | Post-run message only |
| `running` | Neutral “Running. Listen.” with no visual phase timing | Run disabled | Enabled | Post-run message only |
| `stopping` | “Stopping…” until owned nodes and automation finish teardown | Run disabled | Visible + disabled | Post-run message only |
| `stopped` | “Stopped by you.” The retained result is not an error. | **Reload for a fresh trial** | Visually hidden + disabled | Frozen stop snapshot available |
| `interrupted` | Retained truthful reason: page hidden or audio suspended/interrupted by Chrome | **Reload for a fresh trial** | Visually hidden + disabled | Frozen interruption snapshot available |
| `complete` | “Run complete. Recorded acceptance trials require a fresh page load.” | **Reload for a fresh trial** | Visually hidden + disabled | Frozen completion snapshot available |
| `runtime-error` | Specific resume/schedule cause | **Reload page** | Visually hidden + disabled | Frozen error snapshot available |

`complete` means the canonical track source ended naturally with no typed error. Crossfade completion at beat 9 does not by itself mark the run complete. Preserve every terminal outcome until page reload.

Track `freshLoadEligible`, initialized to `true`. The Run handler synchronously verifies `state === 'ready' && freshLoadEligible`, then sets `starting`, sets `freshLoadEligible = false`, increments the generation, and renders native disabled states before its first promise/`await`. Two rapid click/Enter/Space activations must create exactly one generation, one `resume()`, and one schedule.

If Stop, page hiding, or context interruption occurs while `resume()` is pending, synchronously invalidate the generation and start teardown without awaiting the unresolved promise. When no sources exist, teardown settles immediately. Both late fulfillment and late rejection from the stale `resume()` cause no scheduling, error rendering, or state mutation. `stopping` ends only when the shared idempotent teardown finishes.

The primary action slot becomes Reload after any terminal state; same-session Run is unavailable. Stop keeps one permanent DOM slot: enabled in `starting` and `running`, visible but disabled in `stopping`, and visually hidden plus natively disabled otherwise. Never replace the Stop node.

During `starting`, `running`, and `stopping`, Diagnostics renders only: **“Diagnostics available after the run ends.”** It does not render schedule times, source counts, phase, or a live console even when expanded. Populate one frozen key/value snapshot only after `stopped`, `interrupted`, `complete`, or `runtime-error`.

Runtime contract:

1. Before enabling Run, apply one 15-second overall load deadline to metadata fetch, WAV fetch, digest, and decode.
   - Fetch and schema-validate `./asset-metadata.json` and `./calibration.json`.
   - Fetch `./assets/gate-track.wav` as bytes, compute SHA-256 with `crypto.subtle.digest`, and compare it with immutable metadata before decoding those exact bytes.
   - Validate decoded channels and duration plus the annotated entry/tail bounds. Web Audio may resample the decoded buffer to the one owning device context (for example, 48 kHz on Android), so validate decoded sample rate against `AudioContext.sampleRate`; the committed WAV and clean-room generator remain byte-verified at 44.1 kHz.
   - Invalidate the load generation on timeout/error so late fetch, digest, or decode completion cannot reach `ready`.
   - Any load error replaces the primary slot with “Reload page.”
2. Create exactly one `AudioContext` and one master output graph.
3. Generate a short percussion buffer in memory; create one `AudioBufferSourceNode` per beat.
4. In the direct Run handler, after the synchronous atomic UI/generation guard:
   - Catch a synchronous throw from `context.resume()`.
   - Otherwise retain `resumePromise`, start a five-second generation-keyed startup watchdog, then synchronously create, own, and schedule the full generation before the first `await`.
   - A resolution enters `running` only when generation still matches, UI state is `starting`, and `context.state === 'running'`.
   - A current rejection or watchdog expiry invalidates the generation before teardown and enters `runtime-error`; stale resolve/reject/timeout may release resources but cannot render or mutate UI.
5. Schedule beat 1 at `audioNow + 0.1s`.
6. Start the track at beat 1 with offset `0`; keep its crossfade gain at `0` until beat 5.
7. Schedule eight percussion hits.
8. Apply equal-power curves over beats 5–9.
9. Use initial trims `track=0.70`, `percussion=0.35`, `master=0.80`; these are provisional until Task B2 calibration.
10. Expose one Run button, one Stop button, truthful status text, and a local diagnostics panel.
11. No file input, local storage, analytics, network upload, service worker, or provider code.
12. DOM timers, animation frames, status rendering, and diagnostic phase labels never trigger gain automation, source starts/stops, completion, or pass/fail. UI phase is derived from the immutable audio schedule and is control-plane information only.

Pre-deploy lifecycle gate in `tests/audio-engine.test.mjs`:

- Each source record is registered and receives `onended` before throw-prone connection/start work. Fields are: `generation`, `kind`, `node`, `startCommitted`, `intentionallyStopping`, `ended`, and `disconnected`.
- If partial scheduling fails, records with `startCommitted=true` receive defensive `stop()`; unstarted records disconnect/delete synchronously. Catch cleanup errors per node so one failure cannot block the rest.
- Inject a failure after every creation, connection, automation, and start step. Every case ends with empty registries and exactly one retained `schedule-failed`.
- The initial synchronous schedule count is one. Late resume settlement must add zero schedules and produce no stale UI mutation.
- Terminal teardown is first-writer-wins: atomically capture the accepted generation, cause, and target state. Later Stop/hidden/statechange/onended callers join the same teardown promise and cannot relabel the outcome.
- Running/manual teardown settles after all expected `onended` callbacks or a 100 ms cleanup deadline. Hidden/suspended/non-running teardown marks sources intentional, cancels automation, defensively stops started nodes, synchronously disconnects/clears registries, and settles immediately; late callbacks are idempotent.
- Freeze the terminal diagnostic snapshot, close the sole `AudioContext` exactly once, and ignore the resulting `closed` state event. Pending-resume cancellation may close immediately or use a stale-settlement `finally` solely to release resources.
- Test every pairwise ordering of manual Stop, page hide, context interruption, natural track end, and close-related statechange that can target the same generation.

Mobile and accessibility contract:

- One-column layout, `max-width: 36rem`, centered horizontally, with at least `20px` page padding and safe-area insets.
- Include `<meta name="viewport" content="width=device-width, initial-scale=1">`; never disable browser zoom.
- Primary and Stop buttons are full-width on narrow screens and at least `56px` high; all touch targets are at least `48px` in both dimensions, separated vertically by at least `12px`.
- Status and both control positions remain in the initial viewport; hidden/disabled controls do not cause the primary content to jump.
- The above-fold promise applies only at default zoom on a `360×640` CSS-pixel viewport. At 200% browser zoom and 200% Android font scaling, allow vertical scrolling but no horizontal scrolling, clipping, overlap, or target-size reduction. Verify reflow at `320px` CSS width.
- Use semantic `<main>`, one `<h1>`, native `<button>`, and `<details><summary>` for Diagnostics.
- Run and Stop use `<button type="button">` with native `disabled`, visible pressed/disabled/focus states, and labels that do not rely on color or hover.
- Readiness and terminal outcomes use `aria-live="polite"`; errors use a non-color cue and `role="alert"`. Timed phases and diagnostics use `aria-live="off"` so announcements cannot cover the audio.
- Phase/status updates never move focus. When a state transition natively disables the focused control, move focus once to the next enabled control: primary Run → Stop on `starting`; Stop → primary Reload on a terminal transition. Never focus status or live-region text. Verify with keyboard activation in desktop Chrome and an Android Chrome hardware keyboard when available.
- Keyboard order is document order; Enter/Space activates focused controls; visible focus has at least a `2px` high-contrast outline.
- Body text is at least `16px`; body contrast is at least `4.5:1`; interactive boundaries and focus indicators are at least `3:1`.
- Respect `prefers-reduced-motion`; no motion is required for comprehension.
- Use an intentional native system font stack for this spike. This is an explicit exception to brand typography guidance: no external or bundled font may add a fetch, licensing, or rendering variable to the audio feasibility test.
- Define CSS variables for surface, text, muted text, action, focus, success, and error colors. Use an off-white surface, near-black text, one restrained action color, no gradient, no decorative shadow, and no card mosaic.

Diagnostics panel, held only in page memory, rendered as fixed key/value rows rather than an append-only console:

At `ready`, expose an immutable **identity-only** snapshot containing the deployed commit, asset ID, runtime-verified WAV SHA-256, frozen trims, and load-to-ready latency. These fields contain no schedule/phase cue and provide the required pre/post acceptance identity evidence. During `starting`, `running`, and `stopping`, continue showing only that frozen identity snapshot plus “Live timing diagnostics withheld during listening.” Do not reveal schedule, phase, source, or teardown fields until terminal state.

- Deployed commit from the workflow-injected HTML meta tag
- Asset ID and SHA-256
- Frozen track/percussion/master trims
- Context state before and after `resume()`
- Load-to-ready latency in milliseconds
- Active run generation
- Scheduled track start, crossfade start, and end as both `AudioContext` times and offsets from beat 1
- Number of percussion sources scheduled/ended
- Final derived phase at terminal snapshot: pre-roll, overlap, music-only, cancelled, complete
- Terminal state and first accepted cause
- Final active-source count and teardown-settled boolean
- Final `AudioContext` state
- Interruption reason and typed error code

No live timing/phase polling exists. On complete, error, manual stop, or interruption, atomically replace the identity-only view with the complete frozen report. Label the section: **“Control-plane diagnostics; not proof of what was heard. Local to this page.”**

Required error codes:

- `asset-fetch-failed`
- `metadata-invalid`
- `asset-integrity-failed`
- `module-identity-failed`
- `load-timeout`
- `decode-failed`
- `resume-failed`
- `startup-timeout`
- `schedule-failed`
- `context-close-failed`
- `interrupted`

Every error shows cause plus one recovery action. Do not print local paths or audio bytes.

Recovery mapping is deterministic: `asset-fetch-failed`, `metadata-invalid`, `asset-integrity-failed`, `module-identity-failed`, `load-timeout`, `decode-failed`, `resume-failed`, `startup-timeout`, `schedule-failed`, `context-close-failed`, and `interrupted` all disable Run and offer exactly one primary action: **Reload page**. A close failure does not overwrite an earlier accepted visible cause, but terminal Diagnostics retain `context-close-failed` and the trial fails teardown acceptance. Manual Stop is the non-error reason `manual-stop`, not `interrupted`.

### Task A4: Deploy the exact commit to GitHub Pages

**Files:**
- Create `.github/workflows/deploy-pages.yml`
- Create `.github/workflows/ci.yml`

Deployment workflow requirements:

- Trigger on pushes to `main` and manual dispatch.
- `ci.yml` runs verification for pull requests only. It is informative and not the deployment gate.
- `deploy-pages.yml` contains `verify`, `stage`, and `deploy` jobs. `stage` needs `verify`; `deploy` needs `stage` and consumes only the artifact from that same successful run. A failed verify can never deploy.
- Provision exact Python `3.13.7` and Node `22.22.3` in verify jobs.
- Stage only `spikes/001-mobile-web-audio-gate/` as the Pages artifact.
- Pin every used GitHub Action to a full immutable commit SHA and add a comment naming the corresponding release tag.
- `verify` and `stage` receive `contents: read` only. `deploy` receives only `pages: write` and `id-token: write`, performs no source checkout, and uses the protected `github-pages` environment with URL from the deployment step output.
- Add Pages deployment concurrency so a newer `main` deployment supersedes an older queued run without overlapping publication.
- Deploy the immutable commit and expose it at `https://tonyisup.github.io/bpm-music-match/`.
- Copy the spike into a temporary staging artifact, replace one `index.html` meta placeholder with the full immutable commit SHA using a small checked Python step, and upload only that staged copy. The checked-in HTML retains the placeholder; the app reads the deployed meta tag. Do not fetch separate build metadata at runtime.
- After exact runtime provisioning, both `ci.yml` and `deploy-pages.yml` invoke only `python3 scripts/verify_gate.py`; that executable owns stage order. `deploy-pages.yml` stages only after that command passes.
- Deployment cannot upload user files because Gate 1 has no file input.
- All HTML/module/style/JSON/WAV references are document-relative (`./...`) so the project-site base path is correct.

After push:

1. Enable Pages with GitHub Actions as the build source.
2. Wait for the workflow to complete.
3. Verify the root, `.mjs` modules, JSON, and WAV return HTTP 200 over HTTPS with acceptable HTML, JavaScript, JSON, and audio `Content-Type` values; verify no commit placeholder remains.
4. Record the deployed commit and workflow URL.
5. Load the deployed page in Chrome and require the module graph to reach `ready`; HTTP 200 alone does not pass.
6. Confirm the deployed HTML meta tag and frozen diagnostics report the same commit.

The root README uses this bounded run-discovery/watch block after a push so “wait” is executable:

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

### Task A5: Run one non-acceptance smoke trial

Run one desktop Chrome-family browser smoke against the deployed HTTPS URL. This cannot clear Gate 1.

Given the loaded page, when Run is pressed once, then observe:

- Context changes to `running` without a second gesture.
- Percussion-only phase is audible first.
- Music is not audible before beat 5.
- Midpoint contains continuous overlap with no dead air.
- Music remains after beat 9.
- Percussion does not remain after beat 9.
- Diagnostics reach `complete` with no typed error.

**Hard stop:** If any item fails, write `spikes/001-mobile-web-audio-gate/README.md` verdict `PARTIAL` or `INVALIDATED`, diagnose at most two repair attempts, and do not build Phase B architecture around the failure.

---

## Phase B: Validate lifecycle and accept only after smoke success

### Task B1: Run deployed lifecycle smoke checks

All lifecycle ownership and race tests land before Task A4. After the one-gesture overlap smoke passes, run two additional non-counted fresh-load checks against the same deployed build:

1. Let the canonical source end naturally. Require terminal `complete`, frozen diagnostics, empty registries, and a closed context.
2. Reload, press Run, then manual Stop during overlap. Require terminal `stopped`, the 20/25 ms running teardown path, no stale completion, empty registries, and a closed context.

These checks remain non-acceptance because desktop/fake behavior cannot prove Android Chrome interruption semantics. If either fails, stop before calibration and Android trials.

The canonical gate remains `python3 scripts/verify_gate.py`. For diagnosis only, the spike README lists the verifier-supported `RERUN` commands for individual Python or Node stages.

### Task B2: Calibrate once and freeze trims

Use the deployed canonical asset and generated percussion on a non-acceptance browser.

1. Confirm no clipping through automated sample/curve checks and audible smoke.
2. Adjust only `trackTrim`, `percussionTrim`, and `masterGain` if masking or clipping is obvious.
3. Record final values only in canonical `calibration.json`; the spike README explains the procedure and links to the JSON but does not duplicate mutable values. Never mutate generated asset metadata during calibration.
4. If trims changed: run `python3 scripts/verify_gate.py`, commit, push, wait for the gated Pages deployment, repeat every Task A4 identity/MIME/readiness check and one Task A5 smoke, then record the new commit and workflow URL.
5. If trims did not change, explicitly retain and freeze the already-smoked deployment.
6. Freeze deployments before acceptance. Any later code, asset, or level change invalidates prior acceptance trials and restarts all three.
7. Do not add normalization, compression, limiting, or user-facing sliders.

### Task B3: Complete the real-device worksheet

**Files:**
- Create `docs/validation/mobile-audio-gate.md`

Header fields:

```text
build commit
workflow URL
served HTTPS URL
local verification duration
local Quick Start URL
local README-to-Ready duration
Pages workflow duration
load-to-ready latency
HTML meta commit before trial
runtime-verified WAV SHA before trial
phone model
Android version
Chrome version
asset id and SHA-256
frozen track/percussion/master trims
trial number 1–3
fresh page load: yes/no
```

Per-trial observations:

```text
context before Run
context after first Run press
second gesture required: yes/no
percussion-only phase audible: yes/no
music audible before beat 5: yes/no
continuous overlap at midpoint: yes/no
dead air: yes/no
music-only after beat 9: yes/no
percussion remains after beat 9: yes/no
background/Stop cancellation settled into stopped/interrupted with teardown complete: yes/no
backgrounded after beat 9 and before natural track end: yes/no
returned to page with no resumed sound: yes/no
interruption reason
error code
terminal state
first accepted terminal cause
final active source count
teardown settled: yes/no
final AudioContext state
terminal state after waiting past original natural end
ideal-condition sonic check: intentional/mechanical
diagnostics revealed no live timing/phase data: yes/no
notes
```

Pass rule:

- Freeze pushes and Pages deployments before trial 1 and through the post-trial identity check.
- All three trials use the same deployed commit, asset hash, device/browser versions, and trims.
- All required fields pass.
- No second gesture is required.
- No early music, dead air, missing overlap, or remaining percussion occurs.
- Cancellation settles into retained `stopped` or `interrupted` with teardown complete and no stale completion.
- In every counted trial, background the page after beat 9 but before natural track end; require terminal `interrupted`, empty registries, no stale completion, and no resumed sound on return.
- Keep the page backgrounded until at least 20 seconds after the original Run activation, then return. Require `terminal state=interrupted`, `final active source count=0`, `teardown settled=yes`, final context state `closed`, no sound, and the same terminal state after the wait; this is the evidence for no stale completion.
- Diagnostics revealed no live timing/phase data before the terminal snapshot.
- Each counted acceptance trial begins from a fresh page load; the UI does not offer a same-session rerun.
- Automated tests verify gain math/API scheduling; ears verify audible execution, not equal-power mathematics.
- After trial 3, reload to `ready` without pressing Run and record the identity-only HTML meta SHA and runtime-verified WAV SHA. Both must equal every pre-trial value; any mismatch invalidates all counted trials.

Any failure leaves Gate 1 `FAIL` or `PARTIAL`. Missing device/URL/version evidence leaves it `BLOCKED`.

### Task B4: Write the spike verdict

Update `spikes/001-mobile-web-audio-gate/README.md`:

```markdown
## Verdict: VALIDATED | PARTIAL | INVALIDATED | BLOCKED

### Technical audio gate
PASS | PARTIAL | FAIL | BLOCKED

### Ideal-condition sonic check
intentional | mechanical | not-run

### Product magic
NOT TESTED UNTIL MILESTONE 2

### What worked
...

### What did not
...

### Surprises
...

### Recommendation for the real build
...
```

A validated spike is evidence for planning Milestone 2, not permission to copy spike code unchanged.

---

## Test matrix

| Surface | Automated | Deployed desktop smoke | Android Chrome acceptance |
|---|---:|---:|---:|
| Asset format/duration/peak/hash | Yes | Loads only | Loads only |
| Equal-power coefficients | Yes | Not judged | Not judged |
| Timing-plan arithmetic | Yes | Diagnostics | Diagnostics |
| Node wiring and teardown calls | Fake-node Phase B tests | Observable side effects | Observable side effects |
| User-gesture resume | No | Informational | **Gate** |
| Audible overlap/no dead air | No | Informational | **Gate** |
| Background interruption | Fake-node contract only | Informational | **Gate** |
| Musical intentionality | No | Non-gating | Non-gating scent only |
| Tap-derived product magic | No | Not tested | Not tested |

## Error and rescue registry

| Codepath | Failure | Rescue | User sees | Test/evidence |
|---|---|---|---|---|
| Asset generation | Non-deterministic bytes or invalid WAV | Fail script; do not commit asset | Build failure | Python verification |
| Asset fetch | HTTP/non-200 | Disable Run | `asset-fetch-failed`; Reload page | Browser smoke |
| Decode | Unsupported/corrupt WAV | Keep Run disabled | `decode-failed`; Reload page | Fake rejection + browser |
| Context resume | Still suspended/rejected | Teardown generation | `resume-failed`; Reload page | Android gate |
| Scheduling | Node/automation call throws | One teardown path | `schedule-failed`; Reload page | Fake-node test |
| Manual/background interruption | Live/scheduled sources remain | Idempotent ramp/stop | `manual-stop` or `interrupted`; retained terminal state; Reload page | Fake + Android gate |
| Stale callback | Old run emits completion | Generation check ignores it | Nothing false | Fake-node test |
| Deployment | Workflow or asset URL fails | Block acceptance | URL/commit missing | GitHub workflow + HTTPS checks |

## Rollback

- Runtime rollback: redeploy the last known-good commit through GitHub Pages.
- Repository rollback: `git revert` the failing commit; never force-push `main`.
- Experiment rollback: mark the spike `INVALIDATED` and stop. Do not preserve abstractions because work was spent on them.
- No database, migration, secret, backend, or user data exists.

## Downstream gates

1. **Milestone 1:** deployed Android Chrome technical gate, this plan.
2. **Milestone 2:** one controlled real track, tap/lock/phase behavior, ten stationary perceptual handoffs.
3. **Field gate:** one real workout with at least three movement changes and repeated manual cadence reseeding. Record whether reseeding interrupts the workout, improves motivation, and would be reused.
4. **Provider/rights feasibility:** only after the field gate. Produce acceptable integration paths and stop conditions before catalog replication.
5. **Replication/catalog:** only after all preceding gates pass.

## CEO review record

### Primary review

- Mode: `HOLD_SCOPE`
- Selected the focused gate over a full product build.
- Corrected deployment claims, stimulus control, duration/tail invariants, and acceptance prerequisites.

**Premise challenge:**

- “A convincing controlled handoff proves the product” is false. Milestone 1 proves only Android Chrome audio-control feasibility; tap-derived product magic remains untested.
- “Any 120 BPM file is an adequate stimulus” is false. The gate needs owned BPM, cue/downbeat, duration, loudness, and format to isolate browser behavior.
- “A local or desktop pass predicts the phone” is false. Only the named deployed Android Chrome trials may clear the gate.
- “Public Pages is harmless” is accepted only because this milestone contains no credentials, uploads, personal audio, or private diagnostics.

**Dream-state delta:** The eventual experience accepts changing human cadence, locks tempo repeatedly during a workout, selects perceptually compatible music, and performs a satisfying handoff without setup. This milestone deliberately removes taps, matching, providers, catalog, adaptation, and field usefulness. It proves the smallest load-bearing mechanism first; Milestone 2 restores tap-derived lock, and a later field gate tests workout usefulness before provider/catalog work.

**Completion summary:** Scope is held, the experiment is executable and falsifiable, all deferred product claims are labeled, and every outcome has a downstream gate or stop condition.

### Independent outside voice

- Verdict: `NEEDS REVISION`
- Findings: 2 blockers and 7 strategic/experimental risks.
- Incorporated mechanics: executable deployment, canonical stimulus, spike-first sequence, explicit claim boundaries, diagnostics, frozen calibration, and one source mode.
- User decisions incorporated: Android Chrome; public GitHub Pages; original 120 BPM asset; post-Milestone-2 field gate; provider work after that field gate.

### Codex outside voice

- Attempted with a five-minute cap.
- Timed out with no usable output.
- Non-blocking fallback: the independent Claude outside voice above.

### CEO voice reconciliation

| Criterion | Primary review | Independent subagent | Resolution |
|---|---|---|---|
| Milestone claim | Hold scope; technical gate only | Browser-risk gate, not product validation | Confirmed |
| Deployment feasibility | HTTPS prerequisite named | Missing executable Pages path was a blocker | Pages path now owned by plan |
| Stimulus validity | Controlled raw graph | Arbitrary asset would confound result | Original deterministic asset |
| Claim/evidence boundary | Separate technical and product verdicts | Product wedge remains untested | Confirmed |
| Field usefulness gate | Added after Milestone 2 | Not independently challenged | Retained user decision |
| Provider timing | Deferred beyond field gate | Not independently challenged | Retained user decision |

Codex was unavailable, so there is no false cross-model consensus claim. Primary + subagent agreement confirmed 4/6 criteria; 2/6 are explicit user decisions rather than outside-voice conclusions.

## DevEx review record

**Classification:** internal experiment platform + documentation, not a public SDK/CLI.
**Mode:** `DX TRIAGE`.
**Target tier:** Champion (<2 minutes) for deterministic verification; Competitive (<5 minutes) for local audible execution.
**Primary developer:** Tony, the senior engineer and sole maintainer.

### Developer persona

```text
Who:       Tony, senior engineer and sole maintainer
Context:   Reopen/clone the repo, prove one mobile-audio hypothesis, diagnose failures, leave reproducible evidence
Tolerance: Five minutes to local sound; one command per gate; no framework ceremony
Expects:   Exact runtimes, deterministic assets, typed failures, tests before deploy, and evidence tied to a commit
```

### Developer perspective

I open the root README and immediately understand the product boundary, but I cannot run anything. It links the approved design, calls the implementation plan “pending,” and contains no runtime versions, verification command, local-server command, expected output, or deployment status. I can inspect the long plan and reconstruct the intended sequence, but that makes internal review history the onboarding surface. By minute two I am context-switching instead of testing the hypothesis. Even if I infer the Python and Node commands, I do not know whether local success matches CI, where calibration belongs, what a correct verifier result looks like, or how to recover when Pages is not configured. The implementation must turn the README into an executable front door: one deterministic verifier, one local-server command, one URL, and exact next actions on failure. The valuable moment is not installing tooling. It is pressing Run on the exact deployed build and hearing the continuous handoff while diagnostics prove the commit and asset identity.

### Benchmark and magical moment

External search was unavailable. Reference onboarding benchmarks are Stripe (~30 seconds), Vercel (~2 minutes), and Firebase (~3 minutes); they are calibration points, not product competitors.

| Surface | Current TTHW | Target | Delivery choice |
|---|---:|---:|---|
| Repository verification | Not runnable from README | <2 min | `python3 scripts/verify_gate.py` |
| Local audible gate | Not documented | <5 min | three-step root README Quick Start |
| Real magical moment | Not deployed | one click after load | public Pages gate with commit/hash evidence |

### Developer journey

| Stage | Developer does | Current friction | Planned resolution |
|---|---|---|---|
| Discover | Opens root README | Stale plan status, no runnable path | Link reviewed plan and current Pages/workflow status |
| Install | Runs verifier | No preflight or dependency contract | Exact Python/Node check before work |
| Hello World | Verify, serve, press Run | Commands scattered through plan | Three-step Quick Start with expected output/time |
| Real usage | Pushes gated Pages build | First-time Pages setup implicit | Root README setup/deploy/status runbook |
| Debug | Reads failed stage/app code | Developer fixes absent | Actual/expected/fix output + spike error reference |
| Upgrade | Creates a new commit | Versioning would imply false compatibility | New SHA/new evidence; prior trials invalidated |

### First-time confusion resolved

- Root README’s “plan pending” text is replaced with the actual reviewed plan/status.
- The golden path is `verify → serve → open`, not “read the plan and infer.”
- Verifier output names each stage and total duration; failure names the exact rerun/fix.
- Root and spike README responsibilities are disjoint and cross-linked.
- `calibration.json` is the only mutable trim record; generated metadata remains immutable.
- First-time Pages setup, workflow run, deployed URL, and evidence locations are explicit.

### Three developer-error traces

| Failure | Developer sees first | Cause/evidence | Exact recovery |
|---|---|---|---|
| Runtime mismatch | `FAIL runtime: Node 22.22.3 required; found …` | actual and expected versions | install/select exact version, rerun verifier |
| Asset reproduction mismatch | `FAIL asset: byte/hash mismatch` plus `CAUSE/RERUN/FIX` | temp output and immutable metadata | supported unittest plus generator `--output-dir /tmp/bpm-gate-debug`; never overwrite silently |
| Pages unavailable | Pages setup block observes GET 404 | repository/branch/workflow state | idempotent POST-or-PUT block, then verify `build_type=workflow` |

The spike README maps every runtime code to problem, likely cause, and Reload recovery; diagnostics may retain the original local exception but user copy stays typed.

### DX scorecard

| Dimension | Initial | After plan fixes | Evidence |
|---|---:|---:|---|
| Getting Started | 1 | 9 | no commands → one verifier + three-step Quick Start |
| API/CLI | 4 | 9 | scattered commands → stable zero-dependency entrypoint |
| Error Messages | 7 | 9 | typed app errors + actionable developer failures |
| Documentation | 4 | 9 | explicit root/spike ownership and expected output |
| Upgrade Path | 8 | 9 | intentionally commit-addressed disposable artifact |
| Dev Environment | 6 | 9 | exact local/CI versions and same gate order |
| Community | 8 | 8 | public personal experiment; ecosystem correctly excluded |
| Measurement | 6 | 9 | verifier, workflow, and load-to-ready durations |
| **Overall** | **5.5** | **8.875 (reported 9)** | zero unresolved DX decisions |

### DX implementation checklist

- [ ] Verification finishes in under two minutes on the target development machine.
- [ ] Local audible flow reaches `ready` in under five minutes. Measure from opening the root README in a fresh clone/reopen with prerequisites already present through the locally served page entering `ready`; record the fixed local URL and elapsed wall time.
- [ ] First run produces named PASS stages and total duration.
- [ ] Deployed page delivers the one-click audible magical moment.
- [ ] Every developer/app error has problem, cause, actual value where safe, and exact fix.
- [ ] Local verifier and deploy verify job execute the same gates in the same order.
- [ ] Root/spike README examples are exercised during implementation.
- [ ] `/devex-review` measures the implemented flow after deployment.

### Explicitly not in scope

- Package manager, installable CLI, framework, Docker/devcontainer, hot reload, docs site, search, SDK types, plugin API, semver, migration/codemod tooling, changelog, contribution program, community channel, support promise, analytics, or remote telemetry.
- These do not help one maintainer answer the mobile-audio feasibility question and would lengthen TTHW.

### DevEx implementation tasks

- [ ] **DX-T1 (P1)** Add `scripts/verify_gate.py` with exact preflight, CI-order gates, actionable failures, and elapsed time.
- [ ] **DX-T2 (P1)** Replace the root README’s placeholder status with tested Quick Start, expected output, loopback-only serving, idempotent Pages setup/deploy/watch commands, and links.
- [ ] **DX-T3 (P1)** Write the spike README’s architecture, error reference, canonical calibration link, identity-recording steps, smoke, and acceptance runbook.
- [ ] **DX-T4 (P2)** Record verifier, README-to-Ready, workflow, and load-to-ready durations in validation evidence.

No prior DX review exists. External benchmarking search was unavailable. No developer-product expansion was accepted.

### Independent DevEx outside voice

- Verdict before fixes: `DONE_WITH_CONCERNS`; six high, two medium, and one low finding.
- Incorporated: mandatory calibration redeploy/re-smoke, one verifier-owned local/CI gate, identity-only `ready` evidence, terminal teardown proof fields, explicit design/plan mechanics precedence, executable first-time Pages setup/watch commands, canonical verifier output, fixed README-to-Ready timing boundaries, and loopback-only local serving.
- Removed as overengineering: duplicated mutable trim values in README and duplicated raw gate definitions in workflows/B1.
- Codex was not retried after two separate five-minute empty-output timeouts in this pipeline. This independent report is the fallback; no false cross-model consensus is claimed.
- Primary + outside voice agreement confirmed four broad DX categories; the outside voice added four sharper execution/proof categories. All nine concrete findings are incorporated with no SDK, framework, or community expansion.
- Final DevEx status after fixes: `CLEAN`, zero unresolved decisions and zero unhandled high-severity gaps.

## Engineering review record

**Mode:** `FULL_REVIEW`; Step 0 complexity smell explicitly accepted. Roughly fifteen small files remain because tests, provenance, deployment, and evidence are independently inspectable; runtime stays limited to `app.mjs`, `audio-engine.mjs`, and `audio-math.mjs`.

### What already exists

- The repository contains only the approved design, plan, README, and Git metadata; there is no runtime code to reuse.
- Browser-native ES modules, Web Audio, `node:test`, Python `unittest`, and GitHub Pages are the built-ins. No package, framework, bundler, backend, or custom deployment service is justified.
- The public remote exists and the expected Pages route is fixed, but the Pages site currently returns 404; implementation must configure and verify that path rather than create another hosting path.

### Architecture and ownership

```text
GitHub main commit
  ├── CI: verify_gate.py (sole ordered local/CI gate)
  └── Pages deploy: verify_gate.py → copy spike → inject commit meta → immutable artifact
                                      │
                                      ▼
Android Chrome / one document
  index.html + styles.css
            │ invokes main()
            ▼
  app.mjs ── pure UI transition/button model ──▶ DOM
     │
     ├── loads canonical WAV + metadata
     └── one gesture: resume() call → synchronous schedule → first await
                                      │
                                      ▼
                              audio-engine.mjs
                 generation + source ownership + teardown
                    │                         │
                    ▼                         ▼
              audio-math.mjs          one AudioContext graph
              immutable plan          percussion bus ┐
              equal-power curves      track bus      ├─ master ─▶ destination
                                                     ┘
```

Only `audio-engine.mjs` may create Web Audio nodes, schedule source starts/stops, or mutate gain automation. `audio-math.mjs` is pure. `app.mjs` owns user-visible state but consumes frozen engine reports; DOM time never drives audio time.

### Run and cancellation sequence

```text
Run activation (same JS turn)
  guard state + freshLoadEligible
  → state=starting; consume eligibility; generation++
  → resumePromise = context.resume()
  → synchronously create/register/schedule every owned node
  → first await / promise reconciliation
       current resolve  → state=running
       current reject   → teardown → runtime-error
       stale result     → no-op

Stop/hidden while resume pending
  generation++ synchronously
  → teardown without awaiting resume
  → late resolve/reject cannot schedule, render error, or mutate state
```

### Review decisions

| ID | Decision | Engineering reason |
|---|---|---|
| D18 | Keep explicit modular spike | File count represents evidence boundaries, not services |
| D19 | Call `resume()`, synchronously schedule, then await | Strongest gesture path and deterministic ownership |
| D20 | Use `.mjs` for all runtime modules | Browser and Node share exact source without package metadata |
| D21 | Reason-aware teardown | Suspended clocks cannot be trusted to execute delayed ramps |
| D22 | Inject commit into staged HTML meta | Removes independent metadata fetch/cache race |
| D23 | Pin action commit SHAs and least privileges | Makes deployment trust match immutable-build claim |
| D24 | Regenerate asset in a temporary directory | Proves reproducibility without mutating source in CI |
| D25 | Export pure UI state functions from `app.mjs` | Full branch tests without a DOM package or fourth runtime module |

### Independent engineering outside voice

- Verdict before fixes: `NEEDS REVISION`; 2 critical, 7 high, 5 medium, and 1 low finding.
- Incorporated: bounded/first-writer teardown settlement, CI-gated deployment, lifecycle tests before first deploy, partial-schedule rollback, startup watchdog, runtime asset integrity, explicit Android interruption protocol, acceptance-build freeze, fixed-point generation, job-scoped workflow permissions, MIME/base-path/module execution checks, terminal context closure, injected load tests, and a 128-sample curve bound.
- Removed as overengineering: replacement-run behavior. Duplicate review-task lists will be consolidated into the final dependency-ordered checklist after DevEx.
- Codex final technical pass timed out after five minutes with no output; the completed independent review above is the non-blocking fallback.
- Final engineering status after fixes: `CLEAN`, zero unresolved decisions and zero unhandled critical gaps.

### Code-quality requirements

- Use named constants for BPM, lead-in beats, crossfade beats, schedule lead, asset offset, fade/stop durations, timeout, and frozen trims. No unexplained timing literals outside tests.
- Validate and freeze the timing plan and terminal diagnostic report; do not expose mutable node registries to the UI.
- Catch and map errors exactly once at the engine/app boundary. Preserve the original exception only in local diagnostics; user copy is the typed mapping from the plan.
- Every source record contains generation, kind, source node, intentional-stop flag, and ended flag. Cleanup is idempotent.
- The checked-in HTML commit meta value is a conspicuous placeholder; local runs report `LOCAL/UNDEPLOYED`, never a plausible commit.
- Workflow staging must never modify the checked-out spike directory.

### Test coverage diagram

```text
CODE PATHS                                           USER / DEVICE FLOWS
asset generator                                      page load
  ├── [PLANNED ★★★] deterministic temp regeneration   ├── [PLANNED ★★★] fetch/decode → ready
  ├── [PLANNED ★★★] WAV format/frames/peak/hash        ├── [PLANNED ★★★] timeout/fetch/decode → Reload
  └── [PLANNED ★★★] committed-byte comparison          └── [ANDROID GATE] real decode behavior

audio-math.mjs                                      Run
  ├── [PLANNED ★★★] valid timing plan                  ├── [PLANNED ★★★] rapid activation → one generation
  ├── [PLANNED ★★★] invalid/non-finite inputs           ├── [PLANNED ★★★] resume resolve/reject by generation
  └── [PLANNED ★★★] equal-power endpoints/invariant     └── [ANDROID GATE] one-gesture audible execution

app.mjs                                             Stop / interruption
  ├── [PLANNED ★★★] every legal/illegal state edge      ├── [PLANNED ★★★] pending-resume late resolve/reject
  ├── [PLANNED ★★★] primary/Stop/focus model             ├── [PLANNED ★★★] manual ramp vs immediate interruption
  └── [PLANNED ★★★] single-use Reload terminal model     └── [ANDROID GATE] hide/suspend leaves no residue

audio-engine.mjs                                   deployment
  ├── [PLANNED ★★★] source ownership/onended cleanup     ├── [CI] tests gate Pages artifact
  ├── [PLANNED ★★★] schedule throw + teardown             ├── [HTTPS CHECK] HTML/modules/WAV return 200
  ├── [PLANNED ★★★] every stop timing/idempotence case    └── [DESKTOP SMOKE] deployed control path
  └── [PLANNED ★★★] stale callbacks cannot complete
```

`★★★` means behavior, edge cases, and error paths. Fake-node tests prove API calls and ownership, never autoplay, acoustics, browser suspension, or device latency. Those remain deployed-device evidence.

### Failure-mode registry

| Path | Realistic failure | Test | Handling | Visible outcome |
|---|---|---|---|---|
| Generator | OS/runtime produces different bytes | Temp regeneration + byte comparison | CI fails before deploy | Workflow failure |
| Pages staging | Commit placeholder not replaced | Workflow assertion rejects placeholder | No deploy | Workflow failure |
| Asset load | Slow/non-200/corrupt WAV | Timeout/rejection unit path + deployed smoke | Abort or decode catch | Typed error + Reload |
| Rapid Run | Two events before async render | Atomic activation unit test | Synchronous guard | One run only |
| Resume | Promise rejects after scheduling | Current-generation rejection test | Teardown owned nodes | `resume-failed` + Reload |
| Stale resume | Resolve/reject after Stop | Late resolve/reject tests | Generation no-op | Retained stopped/interrupted |
| Scheduling | Node or automation method throws | Per-call fake failure tests | Shared teardown | `schedule-failed` + Reload |
| Manual Stop | Automation/source already ended | Repeated/idempotent stop tests | 20/25ms running teardown | Retained stopped |
| Backgrounding | Context clock suspends before fade | Non-running teardown test + Android gate | Immediate cancel/stop | Retained interrupted |
| `onended` race | Old callback emits completion | Stale callback test | Generation + intentional-stop guards | No false completion |
| Diagnostics | UI claims acoustic truth | Frozen-report contract + manual review | Explicit control-plane label | No pass automation |

No failure remains silent without both handling and a test/evidence path.

### Performance review

- The canonical 16-second stereo PCM16 WAV is exactly 2,822,444 bytes (2.692 MiB) plus HTTP headers; decoded stereo Float32 storage is 5,644,800 bytes (5.383 MiB). This is acceptable for one preloaded mobile asset and must not be cached in app storage.
- Eight percussion one-shots and one track source are bounded; no long-lived scheduler, polling loop, unbounded log, or repeated-run allocation exists.
- Equal-power curves use a fixed bounded sample count. DOM updates are not frame-driven.
- A 15-second fetch timeout is a failure bound, not a performance target. Record actual first-load readiness in smoke notes if it is noticeably slow; do not add a cache layer in Milestone 1.

### Parallelization

| Lane | Work | Depends on |
|---|---|---|
| A | Generator, canonical WAV, metadata, asset license | — |
| B | `audio-math.mjs` and pure tests | — |
| C | Static HTML/CSS shell and workflow skeleton | — |
| D | `audio-engine.mjs`, fakes, lifecycle tests | A + B |
| E | `app.mjs`, UI-state tests, integration | C + D |
| F | Deploy, desktop smoke, calibration, Android evidence | E |

Lanes A, B, and C may run in parallel worktrees. Merge them before D/E. Deployment and evidence are strictly sequential. Conflict risk is low if Lane C does not implement engine behavior.

### Engineering implementation tasks

- [ ] **ENG-T1 (P1)** Generate and clean-room verify the canonical asset.
- [ ] **ENG-T2 (P1)** Implement pure `.mjs` timing and equal-power contracts test-first.
- [ ] **ENG-T3 (P1)** Implement atomic single-use UI state functions and tests in `app.mjs`.
- [ ] **ENG-T4 (P1)** Implement source ownership, synchronous schedule, stale-promise guards, and reason-aware teardown test-first.
- [ ] **ENG-T5 (P1)** Build SHA-pinned least-privilege CI/Pages staging with HTML commit injection.
- [ ] **ENG-T6 (P1)** Verify all unit, integration-contract, HTTPS asset, and deployed desktop paths.
- [ ] **ENG-T7 (P1)** Run and record three fresh-load Android Chrome trials against one frozen build.
- [ ] **ENG-T8 (P2)** Run post-deploy mobile visual/accessibility QA; do not block technical audio verdict on unavailable hardware-keyboard testing.

## Design review record

**Classification:** task-focused app UI, one disposable experiment screen.
**Initial design completeness:** 6/10.
**Final score after outside-voice fixes:** 9/10.
**Mockups:** not generated; the local gstack designer and browse binaries are unavailable.

### Seven-pass result

| Pass | Before | After | Decision |
|---|---:|---:|---|
| Information architecture | 6 | 10 | Fixed one-screen hierarchy: status → action → result/recovery; diagnostics tertiary |
| Interaction states | 5 | 9 | Added loading, load-error, ready, starting, running, stopping, stopped, interrupted, complete, and runtime-error states |
| User journey | 7 | 9 | Kept the arc neutral: prepare → one press → listen → report/recover; no false product celebration |
| AI-slop risk | 7 | 10 | Classified as app UI; banned hero, cards, gradients, waveform decoration, and phase animation |
| Design-system alignment | 4 | 9 | No `DESIGN.md` or existing components exist; universal tokens apply, with a documented system-font reliability exception |
| Responsive/accessibility | 4 | 9 | Added safe-area layout, 48px minimum targets with 56px controls, landmarks, live-region isolation, focus transitions, contrast, zoom/reflow, keyboard, and reduced-motion rules |
| Unresolved decisions | 5 | 10 | Diagnostics reveal no live timing data; every run is single-use and every recovery reloads |

### Design journey storyboard

| Step | User does | Intended feeling | UI support |
|---|---|---|---|
| 1 | Opens deployed gate | Oriented, not marketed to | Explicit “technical test” label and preparation status |
| 2 | Waits for asset | Knows whether progress or failure occurred | Disabled Run plus fetch/decode status |
| 3 | Presses Run once | Confident the action registered | Atomic `starting` state; no second gesture prompt |
| 4 | Listens | Attentive without visual suggestion | Neutral “Running. Listen.”; no live timing diagnostics |
| 5 | Completes or interrupts | Knows what happened and what to do | Retained terminal result, frozen diagnostics, one Reload action |

### What already exists

- No project design system, UI components, or prior live screen exists.
- The approved design supplies the interaction truth boundary and timing semantics.
- The spike uses native semantic controls instead of inventing a component vocabulary that the real app may discard.

### Design decisions intentionally deferred

- Final product branding, typography, motion, workout-mode layout, tap visualization, and track artwork: not part of a browser feasibility gate.
- Product design-system consultation: deferred until Gate 1 validates the platform and a real product UI is justified.
- Visual mockups: unavailable in the current gstack setup; live post-implementation design QA remains required.

### Design outside voices

- Independent design review: 2 critical, 7 major, and 1 minor finding; all incorporated.
- Codex design review: 4 P0 and 7 P1 findings; all incorporated, including atomic Run, stale-resume teardown, single-use trials, deterministic Reload recovery, no live diagnostics, focus transitions, and zoom/reflow contracts.
- Litmus result after fixes: app identity scannable; one Run anchor; one job per section; cards unnecessary and absent; no decorative motion or shadow; no hard-rejection pattern remains.

| Design criterion | Independent subagent | Codex | Reconciled result |
|---|---|---|---|
| Information hierarchy | Explicit status/action/result hierarchy | Removed misleading brand-first label | Clear technical-test hierarchy |
| Interaction/state completeness | Flagged async Run/Stop states | Found atomic/stale-promise contradictions | Typed atomic state contract |
| Trial-integrity journey | Flagged live diagnostics and fresh-load risk | Required enforced single-use/reload | Phase-blind single-use trial |
| Slop/final-branding boundary | Utilitarian screen | Found premature product brand | Technical label only |
| Responsive/accessibility | Flagged targets, semantics, focus, contrast | Found touch/zoom/focus contradictions | 48/56px, reflow, focus exception |
| Recovery truthfulness | Flagged retained reason/copy | Found ready/terminal contradictions | Retained terminal state + Reload |
| Timing ownership | UI must not drive audio | Confirmed stale async hazards | Audio clock/engine remains authoritative |

Five of seven review dimensions were independently flagged by both voices; Codex added two sharper contradiction classes. All were incorporated with no product-scope expansion.

### Design implementation tasks

- [ ] **DES-T1 (P1)** Implement the exact state table and one-screen hierarchy.
- [ ] **DES-T2 (P1)** Keep diagnostics collapsed during acceptance and mark visually cued runs non-acceptance.
- [ ] **DES-T3 (P1)** Meet touch-target, semantic HTML, live-region, focus, contrast, keyboard, and reduced-motion contracts.
- [ ] **DES-T4 (P2)** Run live mobile visual QA after deployment; do not infer it from plan text.

## Implementation tasks synthesized from CEO review

- [ ] **CEO-T1 (P1)** Generate and verify one deterministic 120 BPM canonical asset.
- [ ] **CEO-T2 (P1)** Deploy the minimal native Web Audio path before hardening architecture.
- [ ] **CEO-T3 (P1)** Verify the deployed root and every module/asset over HTTPS.
- [ ] **CEO-T4 (P1)** Emit typed in-memory diagnostics that separate resume, scheduling, phase, and interruption failures.
- [ ] **CEO-T5 (P1)** Stop after smoke failure; do not proceed to Phase B.
- [ ] **CEO-T6 (P1)** Freeze gain trims before three Android acceptance trials.
- [ ] **CEO-T7 (P1)** Preserve separate technical, sonic-scent, and product-magic verdicts.
- [ ] **CEO-T8 (P2)** Carry the real-workout and provider gates into the post-Milestone-2 roadmap.

## Implementation approval boundary

Autoplan may refine implementation details. It must not silently change:

- true overlapping crossfade as the product;
- one app-owned raw Web Audio graph;
- Android Chrome as Gate 1 acceptance;
- the original 120 BPM canonical Gate 1 asset;
- no tap/matching/provider work in Milestone 1;
- real-device evidence before Milestone 2;
- real-workout field evidence before provider and replication work.

## GSTACK REVIEW REPORT

**Final approval:** Tony approved implementation on 2026-07-24. Decision log ID: `741dc7dc-3e17-45bb-8a97-15eaafb79cf3`.

### Review status

| Phase | Final status | Score/mode | Outside voice | Unresolved blockers |
|---|---|---|---|---:|
| CEO | CLEAN | `HOLD_SCOPE`, 9/10 | Independent subagent; Codex unavailable | 0 |
| Design | CLEAN | task-focused app, 9/10 | Independent subagent + Codex | 0 |
| Engineering | CLEAN | `FULL_REVIEW`, 9/10 | Independent subagent; Codex unavailable | 0 |
| DevEx | CLEAN | `DX_TRIAGE`, 9/10 | Independent subagent; Codex retry stopped after two empty timeouts | 0 |

### Consensus

- CEO: primary + outside voice confirmed 4/6 criteria; 2/6 remain explicit user decisions.
- Design: both outside voices independently confirmed 5/7 dimensions; Codex added two contradiction classes.
- Engineering: 15 outside-voice findings were incorporated; zero critical gaps remain.
- DevEx: primary + outside voice agreed on four broad categories; the outside voice added four execution/proof categories. All nine concrete findings were incorporated.

### Approved decisions

- Public GitHub Pages deployment at `https://tonyisup.github.io/bpm-music-match/`.
- Android Chrome is the sole Gate 1 acceptance platform.
- One generated original deterministic 120 BPM WAV is the canonical stimulus.
- One raw app-owned `AudioContext` controls percussion, track, gains, timing, and teardown.
- Gate 1 is single-use per page load; every terminal recovery is Reload.
- One dependency-free verifier owns local and CI stage order.
- Milestone 2 remains blocked until three deployed Android Chrome trials pass.
- Real-workout and provider gates remain deferred beyond Milestone 2.

### Implementation artifacts

- Aggregated tasks: `/Users/juicebox/.gstack/projects/bpm-music-match/autoplan-aggregated-tasks-20260724.md` (24 tasks: 20 P1, 4 P2).
- Engineering test plan: `/Users/juicebox/.gstack/projects/bpm-music-match/juicebox-main-eng-review-test-plan-20260724-094915.md`.
- Review log: `/Users/juicebox/.gstack/projects/bpm-music-match/main-reviews.jsonl`.
- Restore point: `/Users/juicebox/.gstack/projects/bpm-music-match/main-autoplan-restore-20260724-090046.md`.

### Exit gate

All four reviews are logged, all required plan artifacts exist, task JSONL parses, `git diff --check` passes, and no unresolved blocking question remains. Implementation is authorized. Real-device acceptance is still an external Gate 1 requirement and may not be inferred from desktop or automated results.
