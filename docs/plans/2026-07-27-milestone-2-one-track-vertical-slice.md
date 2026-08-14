# Milestone 2 One-Track Tap-to-Handoff Vertical Slice Implementation Plan

> **For Hermes:** Use `software-development:subagent-driven-development` to implement this plan task-by-task. Enforce `software-development:test-driven-development`: no production behavior is written until its focused test has been run and has failed for the expected missing-behavior reason. Obtain the review-gate approval below before Task 1, and stop autonomous work before Task 14.

**Goal:** Build and stage a deterministic mobile-web vertical slice in which one SHA-pinned local track is selected privately, stable movement taps arm and lock, and an eight-beat percussion-to-song handoff is executed and evidenced without upload, persistence, or generalized matching.

**Architecture:** Product source is an independent static surface under `prototype/one-track/`. Pure ESM core modules own estimator, match, handoff, reducer, effect, replay, and evidence policy; browser adapters own File API, clocks, timers, DOM, and lifecycle effects; one raw Web Audio engine consumes validated immutable plans and never makes product-policy decisions. Final Pages staging maps the reviewed product source to the active root as required by the approved design, keeps `/enroll/` separate, and continues verifying the frozen Gate 1 source/evidence against its accepted identity.

**Tech Stack:** Native HTML, CSS, and ES modules; raw Web Audio and `OfflineAudioContext`; Web Crypto; Node v22.22.3 built-in test runner; Python 3.13.7 standard-library contract/staging tests; GitHub Pages. No dependencies, package manager, bundler, backend, provider SDK, or dynamic data request. Public startup loads only the allowlisted HTML/CSS/modules; after startup settles and privacy tripwires arm—before picker enablement—zero further request is permitted.

**Normative source:** `docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md` (APPROVED). If this plan and the approved design differ, stop and repair this plan; do not reinterpret or modify the approved design during implementation.

---

## Pre-implementation review report

- Reviewed plan candidate SHA-256: `eb7b4943d7e6fb52efcb385641926cea53861a36de4021a91196f7c7070bfb57`
- Reviewed plan candidate lines: `1104`
- Approved design blob: `205026dffb8caeaa98968be9ac6c42f12ecdd2e5`
- Milestone 2 design blob: `b9e4779bdb6a7957f582e35bf89b19ab497b8231`
- CEO/product review: `APPROVE` — authorized final exact-revision review; zero blocker/high findings.
- Design/UX review: `APPROVE` — authorized final exact-revision review; zero blocker/high findings.
- Engineering review: `APPROVE` — authorized final exact-revision review; zero blocker/high findings.
- DevEx review: `APPROVE` — authorized final exact-revision review; zero blocker/high findings; fresh-clone, browser, shell, staging, PR, and diagnostic commands verified.
- Privacy/security review: `APPROVE` — authorized final exact-revision review; zero blocker/high findings.
- Unresolved blocker/high findings: `0`

This report-only append records review results for the exact candidate above. The baseline commit SHA is intentionally not embedded in the commit that defines it; it is captured in the implementation handoff and eventual PR description.

---

## 1. Current baseline and protected surfaces

At plan creation:

- Branch: `feat/m2-one-track-vertical-slice`.
- Approved design and completed sanitized fixture: `docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md`.
- Frozen Gate 1 source: `spikes/001-mobile-web-audio-gate/` and accepted identity `11df30f6f6cf90940bee425847614abaf26cc6f1`.
- Separate enrollment bootstrap: `tools/m2-enrollment/`, staged at `/enroll/`.
- Existing staging/verifier: `scripts/stage_pages.py`, `scripts/test_stage_pages.py`, `scripts/verify_gate.py`, and `scripts/test_verify_gate.py`.
- Existing deployment workflow: `.github/workflows/deploy-pages.yml`.
- `prototype/one-track/` does not yet exist.

Protected throughout implementation:

```text
/enroll/                             frozen enrollment deployed bytes
spikes/001-mobile-web-audio-gate/    no source edits
tools/m2-enrollment/                 no source edits
approved Milestone 2 design          fixture-closure edit only; then frozen
private Island Party MP3             never enters the repository
```

After merge, the active public runtime path is:

```text
/
```

The source directory name is not a public deployment prefix. PR verification stages the exact root artifact without deploying it. Merge/publication remains a human gate; once merged, the exact reviewed root build is the candidate used by the Task 14 Pixel protocol.

## 2. Locked fixture, policy, and build identity

Only these sanitized facts may enter source, tests, evidence, or staging. Never add the selected filename, path, URI, raw bytes, decoded samples, artwork, audio content, or private-file-derived strings.

### Asset fixture

| Field | Locked value |
|---|---|
| schema version | `1` |
| asset version | `m2-island-party-v1` |
| display label | `Island Party by NDA` |
| extension / MIME | `.mp3` / `audio/mpeg` |
| SHA-256 | `faf3d6de8778bb343c3ae92dff9023facffde8288868e5ee017e842205298521` |
| compressed bytes | `1952287` |
| decoded duration | `122.01795833333334` seconds, tolerance `±0.050` |
| decoded channels | `2` |
| decoded sample rate | `48000` Hz |
| decoded frames | `5856862` |
| exact decoded PCM | `46854896` bytes (`frames × channels × 4`) |
| `applicationMemoryContractPassed` | `true` |
| `ownedReferencesCleared` | `true` |
| `contextsCloseSettled` | `true` |
| `browserHeapObserved` | `false` |

`decodedFrameCount` is a sanitized loader-validation fact. The exported `assetIdentity` keeps the approved closed identity field set; exact PCM, duration, channels, and rate remain its runtime identity authorities. Privacy claims cover application-owned references and application-controlled DOM/AX after the `change` handler begins, plus armed request/console/runtime/log streams and exported artifacts. They do not cover OS-picker or native-browser UI before handler execution, the observing DevTools channel, malicious extensions, pre-module same-realm compromise, system clipboard internals, or decoder/browser-native/process memory; `browserHeapObserved: false` remains the explicit honesty marker.

### Experiment config

| Field | Locked value |
|---|---|
| config version | `m2-config-v1` |
| track BPM | `110`, manually confirmed 1:1 |
| meter | `4/4` |
| target-entry downbeat | `17.579` seconds |
| lead-in | `4` beats |
| post-crossfade tail | `2` seconds |
| percussion recipe | `kick-snare-v1` |
| percussion / track / master trims | `0.25` / `0.50` / `0.70` |
| BPM match window | `±3.0`, inclusive, using unrounded estimate |
| interval outlier fraction | `0.20`, inclusive |
| stability CV | `0.05`, inclusive |
| reconciliation | `±60` ms, inclusive |
| silence formula | `clamp-1.5x-median-900-1800-v1` |
| crossfade beats | start `4`, target downbeat `5`, end `8` |
| crossfade | `128` paired equal-power samples, `equal-power-sin-cos-v1` |

`kick-snare-v1` is one deterministic composite kick+snare acknowledgement on every accepted physical tap and every planned continuation beat. The app knows beat phase but has no user-provided bar phase, so the recipe does not alternate roles by odd/even tap count. Physical, bridge, adopted, and newly scheduled beats therefore retain identical percussion character across lock. Both layers reach zero within `180 ms`. For cancellation-smoke proof only, the following physical tap starts this normal acknowledgment in a distinct generation; build-owned `smoke-probe-v1` holds it for `250 ms`, then applies the same `20 ms` ramp and `25 ms` stop bound. This probe policy does not alter the enrolled experiment-config identity.

### Closed run context

The application accepts exactly one non-sensitive `run` query value before file selection:

| Run value | Derived records |
|---|---|
| `session-1` | cold Slot 1 `CENTER`, then warmed Slot 2 `LOW_EDGE` |
| `session-2` | cold Slot 3 `HIGH_EDGE`, then warmed Slot 4 `CENTER` |
| `session-3` | cold Slot 5 `LOW_EDGE`, then warmed Slot 6 `HIGH_EDGE` |
| `session-4` | cold Slot 7 `CENTER`, then warmed Slot 8 `LOW_EDGE` |
| `session-5` | cold Slot 9 `HIGH_EDGE`, then warmed Slot 10 `CENTER` |
| `smoke-crossfade` | cancellation smoke during crossfade; excluded from scored denominator |
| `smoke-playing` | cancellation smoke during playing; excluded from scored denominator |

Missing, repeated, malformed, or unknown `run` values fail closed before the picker is enabled. Session, slot, thermal state, assigned class, and `recordKind` are derived from this immutable table, never editable or persisted. The cold context freezes at its first accepted tap. Only resolved cold evidence plus its explicit download gesture followed by Reset advances the same loaded session to the paired warmed context. Smoke runs never advance.

### Immutable build identity

Every staged product HTML and executable module carries one full 40-character deploying commit after `__ONE_TRACK_BUILD_COMMIT__` replacement. Each executable module asserts its local embedded value against `src/build-identity.mjs`; `src/browser/main.mjs` also asserts the HTML meta value. A placeholder, malformed SHA, or mixed module/HTML identity fails closed before file selection or audio setup.

## 3. Architecture and ownership

### Dependency and effect flow

```text
                            PURE, deterministic, no browser globals

 tap event + clock sample ──▶ tap-estimator ──▶ session-reducer
                                      │                │
                                      │                ├──▶ evidence-schema
                                      ▼                │
                               handoff-planner         └──▶ ordered effects
                                      │                         │
                                      └──── immutable plan ─────┘
                                                                  │
──────────────────────────────── effect boundary ─────────────────┼──────────
                                                                  ▼
 File/WebCrypto ─▶ local-track-loader ─▶ browser-coordinator ─▶ Web Audio engine
 timers/visibility ─▶ clock-adapter ───▶          │             (effects only)
 DOM gestures ────────────────────────────────────┤
 renderer ◀──────── state + sanitized view model ─┘

 replay-session feeds the same reducer and records the same ordered state/effect trace.
 No core module imports window, document, File, AudioContext, timers, storage, or network.
```

### State, resource, and evidence ownership

```text
PRIVATE TRANSIENT                 LOADED SESSION                  ACTIVE GENERATION
File handle ─┐
raw bytes ───┼─ loader token ──▶ AudioBuffer ─┐                 tap window
hash state ──┘  (released)       AudioContext ├─ coordinator ─▶ timers + source registry
                                 identities ──┘                 immutable handoff plan
                                                                  │
                                                                  │ terminal event
                                                                  ▼
                                                   coordinator records TerminalEvidenceSnapshot → opaque receipt FIRST
                                                                  │
                                     ┌────────────────────────────┴──────────────────┐
                                     ▼                                               ▼
                           generation/application teardown                EVIDENCE OWNER
                           may release all audio resources                 report snapshot
                           but cannot clear/replace snapshot               terminal snapshot
                                                                           explicit download
                                                                                 │
                                                                                 ▼
                                                                      evidence resolved
                                                                      Reset/Choose/Reload
```

The pure state stores opaque session/generation IDs and sanitized scalars only. It never stores `File`, `ArrayBuffer`, `AudioBuffer`, `AudioContext`, source nodes, timer handles, DOM nodes, promises, or exception objects. Adapters map effect IDs to those resources. The reducer alone selects the first accepted terminal cause and orders `record-terminal` before teardown. The coordinator invokes the private recorder, which freezes `TerminalEvidenceSnapshot` and returns only an opaque no-data `TerminalRecordReceipt`; terminal teardown requires that receipt. The engine never selects a cause or captures evidence. A separate branded frozen `TrialEvidence` is later constructed from the unchanged snapshot plus exactly one closed cleanup result. Timeout, failure, or late settlement cannot replace the snapshot or its first cause.

### Loaded-session capability and release levels

`src/browser/loaded-session.mjs` exclusively owns the private registry entry `{AudioContext, AudioBuffer, identities}` and returns only a branded opaque `LoadedSessionCapability`. The capability API is closed: `borrowForGeneration(generationId, callback)`, `suspend(reason)`, `resetAfterEvidence()`, and `unload(reason)`. The reducer stores only its opaque ID. The coordinator may invoke lifecycle methods but cannot read resources. The engine borrows context/buffer only inside the generation callback and cannot retain them after settlement. The loader creates the capability and relinquishes all raw `File`/`ArrayBuffer` references before returning it.

| Level | Owner/action | Must release | Must retain |
|---|---|---|---|
| generation termination | engine settles through capability callback | source nodes, gain automation, timers, generation registry, borrowed references | loaded capability, buffer, context, identities |
| Reset after resolved evidence | coordinator calls `resetAfterEvidence()` | reducer generation state and finalized evidence ownership | same loaded capability/buffer/context for paired warmed slot; context suspended until next gesture |
| foreground loss | coordinator terminates generation then calls `suspend('foreground-loss')` | active generation resources | loaded capability/buffer/context and immutable terminal snapshot/evidence |
| application teardown / Unload | capability owner invalidates token and closes | pending load, generation, buffer reference, context, registry entry | immutable evidence artifacts only |

Boundary tests must prove one owner, bounded close settlement, borrow invalidation, no stale-generation access, Reset retention, foreground suspension, application teardown, and unexpected context closure across Tasks 7–9.

### Product state progression

```text
awaiting-track → selecting-track → loading-track → ready
                                                ↘ setup error
ready → tracking ⇄ armed ──atomic lock──▶ no-match | handoff → playing
  ▲          │                                 │         │          │
  │          └──unstable silence───────────────┘         └──tap─────┤
  │                                                               ▼
  └────────────── Reset after resolved evidence ◀── evidence-pending
                                                  ▲       ▲
                          interrupted ─────────────┘       │
                          terminating-failure ─────────────┘
                          cancelling ──────────────────────┘

There is no intermediate `locked` browser state. Lock is one serial reducer event.
```

## 4. Mandatory pre-implementation review gate

Do not start Task 1 until the exact plan revision receives all five independent reviews:

1. CEO/product review: scope tests the approved product question and does not hide failure with breadth.
2. Design/UX review: mobile interaction, listening-first verdict capture, accessibility, and singular recovery match the approved state matrix.
3. Engineering review: dependency direction, reducer/effect ownership, transactionality, test seams, and task ordering are executable.
4. DevEx review: every command/path is runnable from a fresh clone with the pinned Python/Node versions.
5. Privacy/security review: private bytes cannot reach repository, staging, network, persistence, diagnostics, errors, DOM, clipboard, or evidence.

Each review must return `APPROVE` or concrete blocking findings. Resolve findings in this plan only, rerun all five reviews after substantive changes, and require zero unresolved blocker/high findings. After three non-converging correction rounds, stop and escalate. Review approval authorizes Tasks 1–13 only; it does not authorize private-file or Pixel trials.

After all five approvals, update this plan status/review report with the two reviewed design blob hashes only, run the unified verifier and `git diff --check`, then create one documentation-only baseline commit containing only `README.md`, both approved design documents, and this plan:

```bash
git add README.md docs/design/approved-design.md \
  docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md \
  docs/plans/2026-07-27-milestone-2-one-track-vertical-slice.md
git commit -m "docs: approve milestone 2 implementation plan"

BASELINE=$(git rev-parse HEAD)
APPROVED_DESIGN_BLOB=$(git rev-parse \
  "$BASELINE:docs/design/approved-design.md")
M2_DESIGN_BLOB=$(git rev-parse \
  "$BASELINE:docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md")
printf 'BASELINE=%s\nAPPROVED_DESIGN_BLOB=%s\nM2_DESIGN_BLOB=%s\n' \
  "$BASELINE" "$APPROVED_DESIGN_BLOB" "$M2_DESIGN_BLOB"
test -z "$(git status --short)"
```

The baseline SHA is captured in the implementation handoff and eventual PR description, never written into the commit that defines itself. From Task 1 onward, the plan and design documents are frozen. Task 13 resolves the unique baseline commit by exact subject and proves no later design/plan drift with `git diff --exit-code "$BASELINE"...HEAD -- docs/design docs/plans/2026-07-27-milestone-2-one-track-vertical-slice.md`.

## 5. Strict execution rules

For every production behavior:

1. Add one focused test for one behavior.
2. Run the exact focused RED command.
3. Confirm failure is the expected missing export/file/behavior assertion—not syntax, fixture, or harness failure.
4. Implement the minimum behavior.
5. Run the focused command GREEN.
6. Run all product tests accumulated so far.
7. Run `python3 scripts/verify_gate.py` to prove frozen Gate 1 and enrollment remain healthy.
8. Run `git diff --check`.
9. Commit only the task's listed files with the listed message.

If a test passes on first RED, revise it until it proves the missing behavior. If production code was written first, delete that production change and restart the cycle. Do not combine task commits, use test-after implementation, or weaken an approved boundary to make a test pass.

### Executable micro-cycle schedule

Before Task 1, run this fresh-clone preflight from the repository root:

```bash
test "$(git rev-parse --show-toplevel)" = "$PWD"
test "$(python3 -c 'import platform; print(platform.python_version())')" = "3.13.7"
test "$(node --version)" = "v22.22.3"
git --version
```

Local commands use the selected `python3`; CI obtains it from `actions/setup-python`. The verifier fails closed on any version drift. Task 11 adds its own Chrome preflight before any browser command.

The broad RED commands inside Tasks 1–12 are task-entry and accumulated-suite checks, not permission to implement a whole module after one module-not-found failure. Create the named test first, prove the exact test exists, run only that name, implement only its minimum behavior, rerun GREEN, then run the accumulated file/suite before moving to the next row. Use this fail-closed shell form for every Node cycle:

```bash
ID='T2-TIMESTAMP-ADMISSION'
FILE='prototype/one-track/tests/tap-estimator.test.mjs'
grep -Eq "^[[:space:]]*test\\(['\"]${ID} " "$FILE" || {
  printf 'FAIL tdd-cycle: no test begins with %s in %s\n' "$ID" "$FILE" >&2
  exit 2
}
node --test --test-name-pattern="^${ID} " "$FILE"
```

Replace `ID` and `FILE` with the exact row mapping below. A RED must exit nonzero for the expected assertion/module reason; GREEN must exit zero. Node's pattern filter alone is insufficient because a missing test name can exit zero. Python contract cycles use the exact `unittest` test path written in the table. A first cycle may fail because its module is absent; its GREEN may create only the export and behavior required by that first cycle. Every later RED must fail an assertion for the newly missing behavior, never another module-not-found umbrella.

| Task | Ordered micro-cycle IDs → exact test file | Expected RED → minimum GREEN |
|---:|---|---|
| 1 | `T1-CONFIG-CLOSED`, `T1-RUN-CONTEXT`, `T1-BUILD-IDENTITY` → `prototype/one-track/tests/config.test.mjs`; Python `scripts.test_one_track_static_contract.OneTrackStaticContractTests.test_runtime_graph_contract` | extra/missing config accepted → closed frozen config; bad/missing run accepted → seven-value parser/table; mixed build accepted → fail-closed assertion; staged/runtime graph violation undetected → exact runtime-only contract |
| 2 | `T2-TIMESTAMP-ADMISSION`, `T2-INTERVAL-OUTLIERS`, `T2-STABILITY`, `T2-SILENCE`, `T2-DISPLAY` → `prototype/one-track/tests/tap-estimator.test.mjs` | invalid clock sample admitted → bounds; wrong filtered median → inclusive outlier rule; wrong CV → exact stability; premature/late lock proposal → clamp formula; wrong tie rounding → display-only rounding |
| 3 | `T3-TIMING`, `T3-PREDICTION-PARTITION`, `T3-TWO-GRID`, `T3-FREEZE` → `prototype/one-track/tests/handoff-planner.test.mjs` | wrong beat/cue math → exact timing; source unclassified/double classified → exhaustive one-of partition; late lock accepted → bounded failure; mutable plan → recursive freeze/brand |
| 4 | `T4-SCHEMA-LOAD`, `T4-TRACKING-ARMING`, `T4-ATOMIC-LOCK-MATCH`, `T4-NO-MATCH-PROTOCOL`, `T4-CANCELLATION`, `T4-EVIDENCE-ORDER`, `T4-STALE-EFFECTS` → `prototype/one-track/tests/session-reducer.test.mjs`; `T4-REPLAY` → `prototype/one-track/tests/replay-session.test.mjs` | invalid event/state accepted → closed schema; wrong tap/silence transition → tracking/armed; rounded/out-of-window lock misclassified → reducer-owned inclusive match; retries/wrong class/pair failure mishandled → exact scored protocol; cancelling tap reused → cancel-only; smoke evidence precedes distinct next-tap generation/probe cleanup → ready-probe flow; teardown precedes snapshot → evidence-first; stale completion mutates state → no-op; replay diverges → same reducer |
| 5 | `T5-TERMINAL-SNAPSHOT`, `T5-RECORD-UNION`, `T5-PRIVACY`, `T5-CANONICAL`, `T5-FINALIZATION`, `T5-EXPORT` → `prototype/one-track/tests/evidence-schema.test.mjs`; `T5-VALIDATOR` → `scripts/validate_one_track_evidence.test.mjs` | mutable/late snapshot → branded frozen snapshot; scored/smoke fields mix → closed union; private/raw value serializes → rejection; polluted serializer leaks → canonical DTO; cleanup mutates first cause/duplicates → one immutable finalization; unsafe export path accepted → fixed data URL; inconsistent corpus passes → fail-closed CLI |
| 6 | `T6-CURVES` → `prototype/one-track/tests/audio-math.test.mjs`; `T6-COMPOSITE-RECIPE` → `prototype/one-track/tests/percussion-buffer.test.mjs`; `T6-OFFLINE-TIMING`, `T6-ADOPTION`, `T6-CANCELLATION` → `prototype/one-track/tests/offline-handoff-renderer.test.mjs` | endpoint/power wrong → exact 128 curves; parity changes timbre → one composite hit; sample/cue/peak oracle fails → exact render; missing/doubled adopted hit → source identity reconciliation; stale/clicking output → ramped generation stop |
| 7 | `T7-PREFLIGHT`, `T7-HASH`, `T7-DECODE-CUE`, `T7-CANCELLATION` → `prototype/one-track/tests/local-track-loader.test.mjs`; `T7-CLEANUP`, `T7-CAPABILITY` → `prototype/one-track/tests/loaded-session.test.mjs` | invalid local metadata passes → preflight; wrong hash reaches decode → hash gate; decode/cue mismatch passes → closed validation; stale load wins → token race; references/context leak → bounded cleanup; second owner/resource read possible → opaque sole-owner capability |
| 8 | `T8-PLAN-VALIDATION`, `T8-RESUME-DEADLINE`, `T8-SCHEDULE`, `T8-ADOPTION`, `T8-TERMINAL` → `prototype/one-track/tests/web-audio-engine.test.mjs` | forged/mutable plan accepted → brand/freeze validation; stale/late resume schedules → token/deadline; ordering/safety offset wrong → synchronous first schedule; source partition mismatch → exact registry transaction; teardown without valid pre-captured terminal receipt/leaks → refuse then settle only resources |
| 9 | `T9-GESTURE-ORDER`, `T9-RUN-CONTEXT`, `T9-RESOURCE-BOUNDARY`, `T9-LIFECYCLE` → `prototype/one-track/tests/coordinator.test.mjs`; `T9-CLOCK-MAPPING` → `prototype/one-track/tests/clock-adapter.test.mjs`; `T9-POLICY-JOURNEY` → `prototype/one-track/tests/golden-journey.test.mjs` | resume/ack ordering wrong → direct-gesture sequence; context drifts → frozen derived context; reset/unload ownership wrong → capability API; foreground/close race diverges → first-cause lifecycle; effect/view-model trace breaks → production core/adapter synthetic journey |
| 10 | `T10-STATE-ROWS`, `T10-FAILURE-ROWS`, `T10-EVIDENCE-FORMS`, `T10-A11Y-LAYOUT`, `T10-NO-TIMING-VISUALS` → `prototype/one-track/tests/renderer.test.mjs`; `T10-FILENAME-PRIVACY` → `prototype/one-track/tests/main.test.mjs`; `T10-GOLDEN-JOURNEY` → `prototype/one-track/tests/golden-journey.test.mjs` | any normative row differs → exact view model; failure lacks one message/action → closed mapping; record form incomplete → kind-specific gating; filename observable → synchronous clearing/sanitized control; focus/reflow/contrast/tap box fails → CSS/renderer fix; counter/waveform/progress appears → forbid; full production render/export trace breaks → causal synthetic journey |
| 11 | `T11-HARNESS-SERVER`, `T11-HARNESS-LIFECYCLE`, `T11-BASE-URL` → `scripts/browser-smoke-harness.test.mjs`; `T11-EXACT-WRONG-HASH`, `T11-NATIVE-PRIVACY-UNIT` → `scripts/one_track_browser_privacy_smoke.test.mjs`; standalone `node scripts/one_track_browser_privacy_smoke.mjs --base-url <url> --expected-build <40-hex>` is a separate CLI smoke, not a `node:test` cycle | traversal/accounting error undetected → harness guard; disconnect/timeout/exit/profile leak → bounded cleanup; fixture misses hash path → exact-size generator; transient private value/request escapes → continuous tripwire; deployed mode cannot verify identity → explicit arguments |
| 12 | Python `scripts.test_verify_gate.VerifyGateContractTests.test_one_track_stages`, `scripts.test_stage_pages.StagePagesTests.test_one_track_root_allowlist`, `scripts.test_one_track_static_contract.OneTrackStaticContractTests.test_workflow_contract` | verifier omits/fails order → stages; root graph/forbidden file stages → exact allowlist; PR deploy or weak permissions possible → workflow gate |

Task 4 must be implemented in the listed order; replay is last and may only call the same reducer. Tasks 7–9 require accumulated cross-boundary capability tests after each local GREEN. Task 13 review fixes restart the relevant named cycle with a new failing regression. Task 14 is manual acceptance and adds no production behavior.

---

## Task 1: Lock sanitized config, run context, and build identity

**Objective:** Establish the independent product boundary, exact fixture/config values, closed static contract, and fail-closed module/HTML build identity before any product logic.

**Files:**

- Create: `prototype/one-track/README.md`
- Create: `prototype/one-track/src/track-metadata.mjs`
- Create: `prototype/one-track/src/build-identity.mjs`
- Create: `prototype/one-track/src/config.mjs`
- Create: `prototype/one-track/src/core/run-context.mjs`
- Create: `prototype/one-track/tests/config.test.mjs`
- Create: `scripts/test_one_track_static_contract.py`

**Steps:**

1. Follow the Task 1 micro-cycles. Assert the exact values in Section 2, deep freezing, a closed key allowlist, `decodedFrameCount × channelCount × 4 === calculatedDecodedPcmBytes`, exact asset/config identity construction, no mutable override, and rejection of non-finite/extra values. `build-identity.mjs` has one canonical machine-readable line `export const BUILD_SHA = '__BUILD_SHA__';` plus its fail-closed assertion API; staging replaces that placeholder exactly once. Task 1 proves shape/value closure only; Task 9 separately proves production assembly provenance.
2. RED-test the seven-value run parser, immutable session/slot/class derivation, cold-to-warmed advancement gate, smoke exclusion, and failure before selection for missing/repeated/unknown values.
3. Write the static Python cycle. Assert the directory is independent, metadata is sanitized and closed, every **staged runtime** `.mjs` source has exactly one build placeholder/assertion, no runtime URL/config fetch is permitted, and protected source paths remain absent from the product import graph. Tests/fakes/scripts are not build-placeholder targets.
4. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/config.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   ```

   Expected: the first named micro-cycle fails for its missing module/behavior. Do not implement later cycles yet.
5. Add only the minimum behavior for each ordered Task 1 micro-cycle. `track-metadata.mjs` is the single source for approved sanitized identity/decode facts; `config.mjs` validates and re-exports frozen identities/fixed limits; `run-context.mjs` is the sole fixed protocol-context authority.
6. Document local start, architecture, no-private-file rule, source-to-root staging, fixed run URLs, and the human merge/Pixel gates in the product-local README only.
7. **Focused GREEN:** rerun the two RED commands; expect PASS.
8. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```

   Expected: all current product tests and the existing 10-stage gate pass; no protected file changes.
9. **Commit message:** `feat: lock one-track fixture and build identity`

## Task 2: Implement the pure tap estimator

**Objective:** Convert accepted monotonic tap timestamps into the approved robust cadence snapshot without browser clocks or side effects.

**Files:**

- Create: `prototype/one-track/src/core/tap-estimator.mjs`
- Create: `prototype/one-track/tests/tap-estimator.test.mjs`

**Steps:**

1. Follow the Task 2 micro-cycles one at a time for: maximum eight accepted taps; adjacent intervals; `250`/`2000` ms inclusive range; single-pass seed median; `20%` inclusive outlier retention; stable median; population CV; four-valid-interval arming threshold; exact `5%` inclusive CV; exact BPM; display rounding isolated from policy; and silence clamp.
2. Add timestamp-admission tests for non-finite, repeated, decreasing, `>16 ms` future, and `>100 ms` late timestamps. A range-invalid interval rejects only that interval, not either endpoint tap.
3. Add cadence-estimation sequences at `107`, `110`, and `113` BPM plus delayed-interval recovery and timeout-clamp controls. Do not classify match/no-match or assigned protocol class in this module.
4. **RED command:**

   ```bash
   node --test prototype/one-track/tests/tap-estimator.test.mjs
   ```

   Expected: FAIL with module-not-found for `src/core/tap-estimator.mjs`.
5. Implement immutable input/output helpers exactly from the approved formulas. Export full-precision `estimatedBpmExact`; use ties-away-from-zero only for display. The estimator has no track BPM, match window, run context, or protocol-class input.
6. **Focused GREEN:** rerun the RED command; expect all estimator cases PASS.
7. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
8. **Commit message:** `feat: add deterministic tap estimator`

## Task 3: Implement immutable handoff planning and prediction classification

**Objective:** Produce one validated eight-beat plan that exhaustively classifies owned predictions and aligns the curated downbeat/crossfade without touching Web Audio.

**Files:**

- Create: `prototype/one-track/src/core/handoff-planner.mjs`
- Create: `prototype/one-track/tests/handoff-planner.test.mjs`

**Steps:**

1. Test exact timing math first: `beatDuration = 60 / BPM`; beat 1 at least `audioNow + 0.100`; eight strictly increasing beats; track starts at beat 1 with offset `targetEntryDownbeatSeconds - 4 * beatDuration`; fade starts at beat 4; curated downbeat is beat 5; fade ends at beat 8; song-only starts at beat 9.
2. Test `0`, `1`, and `2` whole-beat catch-up advances and typed failure above two. A due prediction inside the 100 ms transaction window is a bridge, never beat 1.
3. Test ownership snapshots with zero, one, and two simultaneous predictions: bridge+adopt; adopted beat 1/2; unaligned cancellation; just-before-start classification using one output sample; and exact one-of bridge/adopt/cancel set equality.
4. Test invalid/duplicate source IDs, non-frozen identities, mutable snapshots, set mismatch, negative track offset, insufficient post-fade tail, and non-finite timings fail before a plan is returned.
5. **RED command:**

   ```bash
   node --test prototype/one-track/tests/handoff-planner.test.mjs
   ```

   Expected: FAIL with module-not-found for `src/core/handoff-planner.mjs`.
6. Implement a pure planner that returns a recursively frozen plan containing generation/identity data, full-precision estimate and snap BPM, timer lateness, skipped beats, all source classifications, exact beat times, track offset/start/end bounds, trims, and fade/cue times.
7. **Focused GREEN:** rerun the RED command; expect PASS.
8. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
9. **Commit message:** `feat: add immutable handoff planner`

## Task 4: Implement reducer, ordered effects, and deterministic replay

**Objective:** Make pure state the sole policy owner and prove complete serial event traces, first-cause semantics, and stale-generation no-ops.

**Files:**

- Create: `prototype/one-track/src/core/effects.mjs`
- Create: `prototype/one-track/src/core/session-reducer.mjs`
- Create: `prototype/one-track/src/replay/replay-session.mjs`
- Create: `prototype/one-track/tests/session-reducer.test.mjs`
- Create: `prototype/one-track/tests/replay-session.test.mjs`
- Create: `prototype/one-track/tests/fixtures/replay-cases.mjs`

**Steps:**

1. RED-test closed event/effect/state schemas. Every effect has `{sessionId,generationId,effectId,effectType}`; no effect contains a browser object. Reducer output is recursively frozen and effects are ordered.
2. RED-test every approved state transition from `awaiting-track` through evidence resolution, including singular recovery controls, no intermediate `locked`, loading Cancel, Unload, session Reset, application teardown, and unexpected closed context before/after first tap.
3. RED-test tracking policy: bootstrap deadline, stable formula deadline, at most two predictions, reconciliation at `±60 ms`, armed-to-tracking destabilization, unstable silence to ready, and invalid timing safe termination.
4. RED-test atomic reducer-owned matching on unrounded `estimatedBpmExact`: inclusive `107`/`113`, `±3.0001` outside controls, CENTER/LOW_EDGE/HIGH_EDGE assigned-class boundaries, and wrong-assigned-class handoff scoring. The planner consumes the reducer's accepted match decision; the estimator never classifies it.
5. RED-test serial lock races: tap queued before lock updates the snapshot; lock queued first enters handoff/no-match/error and a later tap cancels instead of changing cadence.
6. RED-test protocol outcomes from frozen run context: first and second `cadence-unqualified` return to retry while retaining attempt history; third is a scored technical failure in `evidence-pending`; a destroyed cold loaded session auto-creates paired warmed `paired-session-unavailable`; only resolved/downloaded cold evidence plus Reset advances to warmed.
7. RED-test cancellation policy. A handoff/playing tap is cancel-only and never enters either estimator. A scored run follows its scored terminal path. A smoke run settles to visible `ready` with private probe metadata; the following tap creates a distinct generation and one acknowledgment; a typed automatic smoke-probe completion ramps/stops that generation, settles ownership, and only then enters `evidence-pending`.
8. RED-test first terminal cause, `effect-failed` mapping, `TerminalEvidenceSnapshot` before resource effects, immutable finalization input, stale load/effect/source callbacks, and stale resume success requesting suspend/close without state relabeling.
9. RED-test required replay fixtures: center, both edges, just outside, wrong assigned class, three no-match attempts, paired warmed auto-failure, jitter/outlier recovery, unstable silence, lock/tap orderings, destabilization, bridge/adopt/cancel, catch-up limits, both complete smoke probe flows, visibility/context races, resume/close/teardown failures, natural end, End trial, and stale callbacks.
10. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/session-reducer.test.mjs prototype/one-track/tests/replay-session.test.mjs
   ```

   Expected: the current named Task 4 cycle fails for its missing behavior; only the first cycle may initially fail because the reducer module is absent.
11. Implement only the current micro-cycle's pure transition/effect behavior. Create `replaySession(initialState, events)` only in `T4-REPLAY`; it invokes the same reducer and returns complete ordered state/effect snapshots.
12. **Focused GREEN:** rerun each named command and then the task-entry command; expect PASS.
13. **Full verification:**

    ```bash
    node --test prototype/one-track/tests/*.test.mjs
    python3 -m unittest -v scripts/test_one_track_static_contract.py
    python3 scripts/verify_gate.py
    git diff --check
    ```
14. **Commit message:** `feat: add pure session reducer and replay`

## Task 5: Implement the closed evidence schema and export

**Objective:** Freeze one private terminal snapshot before teardown, derive one immutable finalized evidence identity only after closed cleanup settlement, and permit explicit export only after the required record-kind-specific perceptual fields are complete.

**Files:**

- Create: `prototype/one-track/src/core/evidence-schema.mjs`
- Create: `prototype/one-track/tests/evidence-schema.test.mjs`
- Create: `scripts/validate_one_track_evidence.mjs`
- Create: `scripts/validate_one_track_evidence.test.mjs`

**Steps:**

1. RED-test a private `createEvidenceRecorder()` integration boundary. It owns unexported canonical state and exposes coordinator-held terminal and cleanup writer closures plus one finalizer; no snapshot, cleanup token, or mutable record escapes. A successful terminal write returns only a branded frozen no-data `TerminalRecordReceipt` used to authorize ordered teardown; proxies/forgeries cannot validate it and it carries no evidence fields. Raw caller-built records, forged identities, proxies around a valid branded identity, duplicate/late writes, and UI-derived objects cannot satisfy finalization. The coordinator may write terminal state only from reducer-owned events, and the loaded-session release callback may write cleanup only from its owned release result; integration tests prove no File/filename/URI/byte/sample value reaches either writer.
2. RED-test two immutable artifacts behind that recorder: a recursively frozen private `TerminalEvidenceSnapshot` captured before teardown, and a branded recursively frozen `TrialEvidence` constructed exactly once from that unchanged snapshot plus one closed cleanup result. Test timeout, late settlement, duplicate finalization, cleanup failure, unchanged first cause, forged evidence, and a proxy around valid public output. RED-test a closed `records` discriminated union. `recordKind: 'scored-slot'` requires session/slot/thermal/assigned and actual class, attempts, relative taps, estimator/resume/lock/timer/source decisions, handoff plan, source/cleanup summary, technical verdict, `intentional|mechanical|not-judged`, and booleans for `missingBeat`, `doubledBeat`, `click`, `gap`, `audibleClipping`, `staleAudio`, `ownershipLeak`, and `teardownFailure`. `recordKind: 'cancellation-smoke'` requires `smokeKind: 'crossfade'|'playing'`; machine-derived facts that the cancelling tap was excluded, the old generation settled, the following physical tap created a distinct generation, its acknowledgment was scheduled, and the smoke-probe cleanup settled; plus Tony's observations for click-free old-generation stop, no delayed tail, no doubled acknowledgment, no stale restart, and an audible next-tap acknowledgment. It has no subjective verdict and is excluded from the ten-slot denominator.
3. RED-test attempts/denominator rules, `not-judged` only when technical failure prevented audible handoff, optional auto-failed paired warmed record, and evidence resolution only after all record-kind-specific perceptual fields plus an explicit download gesture. Smoke terminal flow is always `cancelling → ready-with-private-probe-pending → following physical tap starts a distinct normal generation and acknowledgment → automatic bounded smoke-probe ramp/cleanup → evidence-pending → observations → Download → Reset/reload`. `ready-with-private-probe-pending` is the existing visible `ready` state with private smoke metadata, not a new visible state; the probe metadata cannot enter scored estimator state.
4. RED-test that reports reject filename/path/URI, absolute wall-clock/location, `File`, raw byte/sample containers or content, nodes, contexts, exceptions, functions, symbols, unknown keys, inherited data, accessors without invoking getters, non-exact own data-property descriptors, and unbounded strings/arrays. Copy approved scalars into fresh null-prototype private records and freeze snapshots. No claim is made that canonicalization can detect an otherwise transparent proxy supplied as raw input; provenance is enforced instead by private application-owned writers and branded final identities. The closed asset identity still permits its required finite numeric `compressedBytes` and `calculatedDecodedPcmBytes` facts; those counts are not raw byte content.
5. RED-test serialization that accepts only the recorder's branded finalized identity, reads its private canonical snapshot, reconstructs every nested record and array from private state with exact ordered keys, and invokes captured `JSON.stringify`. Records use null prototypes; arrays are rebuilt so inherited hooks cannot influence output. Caller-built reports, proxies around a branded identity, polluted `Object.prototype.toJSON`, polluted `Array.prototype.toJSON`, nested inherited hooks, prototype pollution, or post-module replacement of `JSON.stringify` cannot add fields.
6. RED-test a user-gesture-only export descriptor with a fixed safe filename and `data:application/json;charset=utf-8,` URL containing only the encoded canonical serialization. Reject Blob/object URLs, clipboard, storage, and network export paths.
7. RED-test `validate_one_track_evidence.mjs --dir <directory>` against sanitized synthetic PASS and STOP corpora: closed schemas, one build/asset/config identity, slot order, cold/warmed pairing, 4/3/3 class totals, ten scored records, optional paired auto-failure embedded in its cold export, and exactly two distinct cancellation records. On a structurally valid corpus output only `VALID one-track-evidence scored=10 smokes=2 technical=<0..10> intentional=<0..10> decision=PASS|STOP`. On invalid evidence output exactly four privacy-safe lines: `FAIL one-track-evidence <code> record=<1-based-sorted-ordinal|corpus> field=<closed-field-id>`, `CAUSE: <bounded closed explanation>`, `RERUN: node scripts/validate_one_track_evidence.mjs --dir "$EVIDENCE_DIR"`, and `FIX: docs/validation/milestone-2-one-track-protocol.md#evidence-validator-errors`. Never emit directory names, filenames, paths, unknown keys/values, private-derived strings, exception text, or record content. Actual-value diagnostics are limited to safe booleans/counts/enum IDs and fixed build/version identities. Inject sensitive filename/path/URI/byte/exception sentinels through every failure source and prove direct and wrapped output remain clean.
8. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/evidence-schema.test.mjs scripts/validate_one_track_evidence.test.mjs
   ```

   Expected: FAIL with module-not-found for `src/core/evidence-schema.mjs`.
9. Implement only the current Task 5 micro-cycle: private recorder/provenance integration, closed snapshot/union schemas, canonical copy, one-shot immutable finalization, branded export serialization, safe export descriptor, then validator CLI.
10. **Focused GREEN:** rerun each named cycle and then the task-entry command; expect PASS.
11. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
12. **Commit message:** `feat: add sanitized trial evidence schema and validator`

## Task 6: Implement audio math, percussion, and synthetic offline oracle

**Objective:** Prove handoff timing, equal-power curves, safe trims, and deterministic `kick-snare-v1` output using synthetic data only.

**Files:**

- Create: `prototype/one-track/src/audio/audio-math.mjs`
- Create: `prototype/one-track/src/audio/percussion-buffer.mjs`
- Create: `prototype/one-track/src/audio/offline-handoff-renderer.mjs`
- Create: `prototype/one-track/tests/audio-math.test.mjs`
- Create: `prototype/one-track/tests/percussion-buffer.test.mjs`
- Create: `prototype/one-track/tests/offline-handoff-renderer.test.mjs`
- Create: `prototype/one-track/tests/fake-offline-audio.mjs`

**Steps:**

1. RED-test exactly 128 finite monotonic paired curves from angle `0` through `π/2`, endpoints `(percussion,music)=(1,0)/(0,1)`, and `p²+m²≈1` at every sample. At normalized progress `0.25`, music is `sin(π/8)` and nonzero.
2. RED-test `kick-snare-v1` as the deterministic composite kick+snare mono acknowledgment from Section 2 at the owning context sample rate. Use a fixed integer PRNG seed for snare noise, bounded envelopes, zero DC tail, finite samples, and peak below `1` before trim. Assert identical timbre for physical, bridge, adopted, and newly scheduled hits across odd/even accepted-tap counts; no parity or bar-phase input exists. Require both layers to reach zero by `180 ms`, and separately RED-test the `smoke-probe-v1` 250 ms hold plus 20/25 ms ramp/stop timing.
3. RED-test an injected `OfflineAudioContext` renderer with synthetic impulses/pulse trains only: beats 1–8 and target beat 5 within one rendered sample; fade starts beat 4 and ends beat 8; nonzero target transient at `sin(π/8)`; peak `<0.98` with `.25/.50/.70`; held-value 20 ms cancellation ramp and silence after 25 ms; natural and intentional end distinct.
4. Assert test sources and fixtures contain neither the private SHA's bytes nor private audio. No test opens a local personal file.
5. **RED command:**

   ```bash
   node --test prototype/one-track/tests/audio-math.test.mjs prototype/one-track/tests/percussion-buffer.test.mjs prototype/one-track/tests/offline-handoff-renderer.test.mjs
   ```

   Expected: FAIL because audio modules are absent.
6. Implement deterministic array math and an injected offline renderer. Web Audio consumes the already-validated immutable plan; the renderer does not estimate cadence or choose a match.
7. **Focused GREEN:** rerun the RED command; expect PASS.
8. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
9. **Commit message:** `feat: add synthetic handoff audio oracle`

## Task 7: Implement the local private-track loader

**Objective:** Load only the known fixture in browser memory, hash before decode, validate exact observed properties/cue energy, and release every raw-byte reference.

**Files:**

- Create: `prototype/one-track/src/browser/local-track-loader.mjs`
- Create: `prototype/one-track/src/browser/loaded-session.mjs`
- Create: `prototype/one-track/tests/local-track-loader.test.mjs`
- Create: `prototype/one-track/tests/loaded-session.test.mjs`
- Create: `prototype/one-track/tests/fake-track-loader-deps.mjs`

**Steps:**

1. RED-test the exact load order:

   ```text
   picker result
   → configured extension/MIME equality
   → 20 MiB and exact compressed-size check before read
   → one raw-byte read
   → SHA-256
   → immediate reject on SHA mismatch
   → allocate one AudioContext only for SHA-pinned bytes
   → decode
   → duration/channels/rate/frames/exact-PCM validation
   → bounded 4,096 start/end samples and cue-to-+50 ms RMS/peak
   → release all File/raw-byte/scratch references
   → return opaque loaded-session capability
   ```
2. RED-test one aggregate 15-second hash+decode deadline with deterministic deferred promises. Cover read/hash settlement followed by synchronous cancellation before the continuation microtask and prove no `AudioContext` allocation; independently never-settling read, hash, and decode with prompt token invalidation and bounded teardown that never awaits the hung operation; token recheck immediately before context allocation; stale settlement; one active load; no replacement during load/loaded state; and application teardown of any allocated context/buffer.
3. RED-test limits: exact `.mp3` and `audio/mpeg`; `1952287` bytes; duration tolerance; stereo; 48 kHz; `5856862` frames; `46854896` PCM bytes; 360-second/160-MiB hard limits; cue RMS `>=.010` and peak `>=.050`.
4. RED-test privacy with a deliberately sensitive fake filename and byte sentinel. File-derived strings are consumed only for configured extension/MIME equality and never returned, rendered, logged, thrown, serialized, or passed to config. Downstream assembly receives only equality booleans, the computed SHA, and bounded numeric observations—never the original strings. No object URL, media element, request, storage, worker, or full-channel retained view is allowed.
5. RED-test thenable `resume`/`suspend`/`close` settlement, allocated-context accounting, unexpected closed state, context-close timeout, and raw references cleared even when decode/validation fails. Freeze the allocation registry before release/close starts and prove no context/source can appear afterward. If close times out and later genuinely succeeds, live references may clear, but the immutable historical cleanup result remains timed-out and the reload-only recovery decision cannot change.
6. RED-test the Section 3 capability boundary: one private owner; branded opaque token; generation-scoped borrow; no direct resource access by reducer/coordinator; borrow invalidation after settlement; Reset and foreground retention; application teardown invalidation/clear/bounded close; unexpected-close cleanup.
7. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/local-track-loader.test.mjs prototype/one-track/tests/loaded-session.test.mjs
   ```

   Expected: FAIL with module-not-found for `src/browser/local-track-loader.mjs`.
8. Implement a tokenized, dependency-injected loader and sole-owner capability. Never include private values in errors; emit only approved typed codes and sanitized numeric facts.
9. **Focused GREEN:** rerun each named cycle and then the task-entry command; expect PASS.
10. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
11. **Commit message:** `feat: add private local track session owner`

## Task 8: Implement the transactional raw Web Audio engine

**Objective:** Execute immutable acknowledgment/prediction/handoff/cancellation plans in one owned graph with generation-safe rollback and settlement.

**Files:**

- Create: `prototype/one-track/src/audio/web-audio-engine.mjs`
- Create: `prototype/one-track/tests/web-audio-engine.test.mjs`
- Create: `prototype/one-track/tests/fake-audio.mjs`

**Steps:**

1. RED-test the sole graph through `LoadedSessionCapability.borrowForGeneration`: percussion source → trim → crossfade; track source → trim → crossfade; both → master → destination. There is one capability-owned `AudioContext`, one borrowed buffer, no media element, and no retained direct resource reference after settlement.
2. RED-test direct-tap APIs: schedule acknowledgment synchronously; one pending resume keyed by `{sessionId,generationId,effectId}`; subsequent taps reuse it; schedule occurs before first await; rejection rolls back; stale success suspends idle context or closes after application teardown.
3. RED-test prediction registry records stable ID, time, generation, role, start commitment, intentional stop, end, and disconnect. Derive not-started from `scheduledAudioTime > audioNow + oneSampleDuration`.
4. RED-test complete handoff transaction validation and snapshot set equality before bookkeeping changes; preserve bridge/adopted sources; cancel all cancel IDs; schedule only missing beat indexes; never double-schedule adopted beats.
5. Inject failure after every allocation, connect, automation, start, and registry step. Require total generation rollback, first `schedule-failed`, no attempt to restore rolling predictions, and no leaked ownership.
6. RED-test equal-power `setValueCurveAtTime`, track offset, exact continuation bound, song-only ownership, natural end, and expected source settlement.
7. RED-test terminal teardown only after the coordinator supplies a valid opaque `TerminalRecordReceipt` proving the snapshot was already captured; missing/forged/proxied receipt refuses teardown without mutation. The engine does not select or replace a terminal cause and imports no reducer policy. Given a valid receipt, compute the current envelope, `cancelScheduledValues`, hold current values, linear ramp to zero over 20 ms, source stop at 25 ms; freeze allocation before cleanup begins; bound cleanup; never-settling source/context settlements cannot block invalidation; late genuine close success cannot rewrite the sanitized historical settlement; stale callbacks are no-ops; release the capability borrow exactly once.
8. **RED command:**

   ```bash
   node --test prototype/one-track/tests/web-audio-engine.test.mjs
   ```

   Expected: FAIL with module-not-found for `src/audio/web-audio-engine.mjs`.
9. Implement the narrow engine over injected Web Audio factories. It accepts immutable execution plans plus the recorder's injected receipt validator and reports sanitized settlements; it never decides stability, match, lock, terminal cause, evidence content, verdict, or recovery.
10. **Focused GREEN:** rerun the RED command; expect PASS.
11. **Full verification:**

    ```bash
    node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
    python3 -m unittest -v scripts/test_one_track_static_contract.py
    python3 scripts/verify_gate.py
    git diff --check
    ```
12. **Commit message:** `feat: add transactional Web Audio engine`

## Task 9: Implement the browser coordinator and clock/effect adapters

**Objective:** Serialize browser events into the pure reducer, execute ordered effects, and preserve gesture/audio ordering and lifecycle tokens.

**Files:**

- Create: `prototype/one-track/src/browser/clock-adapter.mjs`
- Create: `prototype/one-track/src/browser/coordinator.mjs`
- Create: `prototype/one-track/tests/clock-adapter.test.mjs`
- Create: `prototype/one-track/tests/coordinator.test.mjs`


**Steps:**

1. RED-test `T9-CLOCK-MAPPING` for `audioNow + (eventTimestampMs - performanceNowMs)/1000`, future/lateness admission, running audible safety `+5 ms`, suspended first-tap lead `+20 ms`, one-sample classification, and sanitized non-finite failures.
2. RED-test a serial event queue with exact insertion order. Timer callbacks dispatch reducer events only; they never start sources, automate gains, complete trials, or decide pass/fail.
3. RED-test direct accepted cadence/probe tap order: atomic state guard → call (do not await) tokenized `resume()` → synchronously execute acknowledgment schedule → enqueue settlement. A cancelling tap follows the cancel-only path and schedules no acknowledgment. Two rapid activations cannot duplicate generation/resume/schedule.
4. RED-test effect registry keys, timer replacement/cancel, stale settlement no-op, startup deadline `1000 ms`, visibility/pagehide/context state changes, foreground restore with no automatic audio, and the exact Section 3 generation/Reset/foreground/application release levels.
5. RED-test the capability/evidence boundary across reducer/recorder/coordinator/loader/engine: the reducer chooses the first cause and orders `record-terminal`; the coordinator calls the private writer and receives the no-data receipt before any resource effect; engine teardown refuses absent/invalid receipts and returns only sanitized settlement; the loaded-session release boundary writes cleanup; finalization follows that closed result. Also prove loaded-session retention on Reset/foreground loss, suspend before reuse, release on Unload/fatal closed context/pagehide, and snapshot/evidence survival after teardown failure.
6. RED-test tap during handoff/playing as cancellation only: it is not inserted into old or new estimator state. In smoke runs, settlement returns to the existing visible `ready` state with private probe-pending metadata; only the following physical tap starts a distinct normal generation and schedules its acknowledgment. After that start is proven, a smoke-only automatic bounded ramp terminates the verification generation, settles its resources, and enters `evidence-pending`. In scored runs, cancellation follows the approved scored terminal/evidence path without this probe.
7. RED-test run context and configuration provenance: URL-derived context enters pure initial state before selection, displays no private value, freezes at first accepted tap, advances to warmed only after resolved/downloaded cold evidence plus Reset, and never advances smoke runs. Production `main`/coordinator imports the reviewed static config directly, exposes no runtime config/override parameter, and preserves every fixed string/policy field through assembly. The integration boundary receives only loader equality booleans, SHA, and bounded numeric observations—not file-derived strings.
8. RED-test `T9-POLICY-JOURNEY` using production estimator/reducer/planner/coordinator/engine/evidence modules with a synthetic loaded-session capability and deterministic clocks. Drive stable 110 BPM taps then silence through the sanitized view-model trace; require one immediate composite acknowledgment per accepted tap, no lock while tapping, atomic silence lock, no missing/doubled pulse through beat 9, nonzero synthetic song cue at beat 5, percussion gone by beat 8, song-only beat 9, and first terminal snapshot.
9. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/clock-adapter.test.mjs prototype/one-track/tests/coordinator.test.mjs
   ```

   Expected: FAIL because clock/coordinator modules are absent.
10. Implement injected adapters around the pure reducer, capability, and engine one named cycle at a time. Convert dependency exceptions immediately to typed safe causes; never forward exception text to state/evidence/UI.
11. **Focused GREEN:** rerun each named cycle and then the task-entry command; expect PASS.
12. **Full verification:**

    ```bash
    node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
    python3 -m unittest -v scripts/test_one_track_static_contract.py
    python3 scripts/verify_gate.py
    git diff --check
    ```
13. **Commit message:** `feat: coordinate one-track browser effects`

## Task 10: Build the accessible listening-first UI

**Objective:** Render the approved mobile state/control matrix with one clear action, no timing distraction, and evidence-loss prevention.

**Files:**

- Create: `prototype/one-track/index.html`
- Create: `prototype/one-track/styles.css`
- Create: `prototype/one-track/src/browser/renderer.mjs`
- Create: `prototype/one-track/src/browser/main.mjs`
- Create: `prototype/one-track/tests/renderer.test.mjs`
- Create: `prototype/one-track/tests/main.test.mjs`
- Create: `prototype/one-track/tests/golden-journey.test.mjs`
- Modify: `scripts/test_one_track_static_contract.py`

**Steps:**

1. RED-test one renderer row for every row in the approved design's **UI and accessibility** state/control/announcement/retained-data matrix. Require loading announcement/Cancel, no per-tap/per-beat live announcements, one-time armed/handoff/playing/interruption/failure/completion announcements, third no-match directly to evidence, frozen measured cadence visibly distinct from fixed track BPM through handoff/playing, and focus movement only when the focused control becomes unavailable.
2. RED-test one renderer row for every code in the approved **Failure contract**: exactly one typed human-readable message, one legal recovery action, correct evidence requirement, and correct retained/released resource statement. No generic catch-all can satisfy a typed code.
3. RED-test the read-only run line (`Session 3 · Slot 5 · LOW_EDGE` or the fixed smoke label), exact honesty copy, configured label/track BPM distinct from tentative/frozen measured BPM, “Stop tapping to lock,” “No match in this one-track test,” and no claim of automatic analysis or arbitrary-file support.
4. RED-test listening-first evidence forms before diagnostics. Scored records require the defining question—“Did the song feel hidden inside the taps?”—with intentional/mechanical (or allowed `not-judged`) plus all eight audible/technical defect booleans. Cancellation records require the closed machine facts and five smoke observations from Task 5 and no subjective score. Diagnostics and Download stay disabled until the active record-kind fields are complete; Reset/Choose/Reload/Unload stay blocked until the download gesture. The first cancellation must visibly return to `ready`; the tap surface remains available and asks Tony to tap once to prove a fresh generation. Only after that tap creates a distinct generation/acknowledgment and the automatic smoke-probe ramp/cleanup settles may the UI enter `evidence-pending` and show the smoke form; `beforeunload` warns there.
5. RED-test filename privacy. A visible semantic **Choose Track** button activates an otherwise non-rendering native file input. On `change`, copy only the event-local `File` reference, set `input.value = ''` synchronously before the first promise/await/read/hash call, and never mirror the value/name into text, status, errors, diagnostics, labels, or accessible names.
6. RED-test layout/accessibility: reserve permanent status and primary/recovery slots; keep the full-width tap surface at least `8rem` block size and within one CSS pixel of the same bounding rectangle across ready/tracking/armed; 48×56 secondary controls; 320 px reflow without horizontal scroll; pinch zoom preserved; safe-area padding; visible focus; reduced-motion pulse disabled; every state named in text not color alone; WCAG AA text contrast and at least 3:1 focus/control-boundary contrast.
7. RED-test no timing distraction: forbid beat counters, countdowns, waveforms, crossfade progress bars/animations, or per-beat visual movement. The only motion is the approved `aria-hidden` tap pulse, disabled under reduced motion; diagnostics remain collapsed until perceptual answers are complete.
8. RED-test `T10-GOLDEN-JOURNEY` by extending Task 9's production policy trace through production `renderer.mjs`, record-kind form gating, collapsed diagnostics, safe data-URL descriptor, and evidence resolution. Assert one immediate acknowledgment per accepted cadence/probe tap, no acknowledgment for a cancelling tap, and no missing/doubled acknowledgment through beat 9.
9. Extend static RED tests for one `<main>`, one `<h1>`, semantic button/native hidden file/details controls, labels, viewport zoom, and the exact CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`. Forbid dynamic network/storage/service-worker/media-element APIs, timing visuals, and staged private media.
10. **Task-entry RED command:**

   ```bash
   node --test prototype/one-track/tests/renderer.test.mjs prototype/one-track/tests/main.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   ```

   Expected: FAIL because HTML/CSS/renderer/main and expanded contracts are absent.
11. Implement one named Task 10 cycle at a time in a semantic one-column UI and thin `main()` that verifies build/run identity, creates adapters, binds native events, and renders pure view models. No side effect occurs merely by importing modules in Node.
12. **Focused GREEN:** rerun each named cycle and then the task-entry command; expect PASS.
13. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   python3 scripts/verify_gate.py
   git diff --check
   ```
14. **Commit message:** `feat: add accessible one-track interaction UI`

## Task 11: Add tested real-browser and privacy smokes

**Objective:** Exercise the actual Chromium module/DOM/File boundary with synthetic non-private inputs, prove no transient or final private-value disclosure, and provide one reusable tested browser harness for loopback and deployed modes.

**Files:**

- Create: `scripts/browser-smoke-harness.mjs`
- Create: `scripts/browser-smoke-harness.test.mjs`
- Create: `scripts/one_track_browser_privacy_smoke.mjs`
- Create: `prototype/one-track/tests/browser-audio-smoke.html`
- Create: `prototype/one-track/tests/browser-audio-smoke.mjs`
- Create: `scripts/one_track_browser_privacy_smoke.test.mjs`
- Modify: `scripts/test_one_track_static_contract.py`
- Modify: `prototype/one-track/README.md`

**Steps:**

1. Before any browser command, require this portable preflight and document the same paths/remediation in the product README:

   ```bash
   for chrome in \
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     /usr/bin/google-chrome /usr/bin/google-chrome-stable \
     /usr/bin/chromium /usr/bin/chromium-browser
   do
     test -x "$chrome" && { "$chrome" --version; break; }
   done
   test -n "${chrome:-}" && test -x "$chrome" || {
     echo "FAIL browser-prerequisite: no supported Chrome executable" >&2
     exit 1
   }
   ```

   Then build `browser-smoke-harness.mjs` by extracting only reusable process/server/CDP/profile mechanics, not enrollment or product policy. RED-test server traversal rejection, exact request accounting, CDP disconnect, command timeout, Chrome early exit, deterministic process termination, temporary-profile cleanup, and empty cleanup residue.
2. Give the product smoke explicit modes: local mode starts the harness loopback server; deployed mode requires `--base-url https://…/` and `--expected-build <40-hex>`. Both verify HTML/module build coherence before selection. Deployed mode first requests cache-busted `/src/build-identity.mjs?v=<EXPECTED_SHA>` and compares its full embedded SHA exactly with `--expected-build`, then loads the fixed run URL. Startup may request only allowlisted HTML/CSS/modules. Install CDP Network/Runtime/Log listeners and DOM/AX tripwires before picker activation; declare startup settled and arm the post-startup boundary before enabling the picker. Chrome discovery uses only the fixed preflight paths.
3. Generate an untracked temporary file of exactly `1,952,287` deterministic non-private bytes under a deliberately sensitive `.mp3` filename; assert its SHA differs from the accepted hash. Do not commit an audio-extension fixture.
4. Before picker activation, install a `MutationObserver` over application text/attributes, take defined accessibility snapshots at every observed application mutation/state transition, and retain event-driven CDP Network/Runtime/Log/exception streams. Through the actual hidden native file input select the temporary file. Claims begin when the app's `change` handler starts: clear `input.value` synchronously before the first await/read/hash; require zero requests after the armed boundary—including module/media/worker/object paths and fetch/XHR/beacon/WebSocket—no object URL, and no filename/byte sentinel in application-controlled DOM/AX, input value, logs, errors, diagnostics, clipboard operations, or export. Explicit nonclaims: OS-picker/native-browser surfaces before handler execution, the observing DevTools channel, malicious extensions, pre-module same-realm compromise, system clipboard internals, and decoder/native/process memory.
5. Load the test-only browser audio page and run native `OfflineAudioContext` with generated impulses/composite percussion. Require curve/timing/peak/cancellation oracle PASS without loading any private audio. Browser-smoke failures use exactly four privacy-safe lines: `FAIL one-track-browser <closed-code>`, `CAUSE: <bounded closed explanation>`, `RERUN: <exact local or deployed command>`, and `FIX: docs/validation/milestone-2-one-track-protocol.md#browser-smoke-errors`. Closed codes cover Chrome discovery, server startup, CDP startup/disconnect/timeout, build mismatch, request tripwire, DOM/AX/input leak, and cleanup residue. Inject filename/path/URI/byte/exception/base-URL/profile-path sentinels into every failure source and prove neither direct output nor unified-verifier `CAUSE` output leaks them.
6. **Task-entry RED command:**

   ```bash
   node --test scripts/browser-smoke-harness.test.mjs scripts/one_track_browser_privacy_smoke.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   node scripts/one_track_browser_privacy_smoke.mjs
   ```

   Expected: the current named harness/smoke cycle fails for its missing behavior; only the first may fail because the harness module is absent.
7. Implement harness and smoke one named cycle at a time. Keep policy in the product smoke, mechanics in the harness, and both deterministic, fail-closed, and self-cleaning.
8. **Focused GREEN:** rerun each named cycle and then the task-entry command in installed Chrome; expect one explicit PASS and zero tripwire events.
9. **Full verification:**

   ```bash
   node --test prototype/one-track/tests/*.test.mjs scripts/browser-smoke-harness.test.mjs scripts/one_track_browser_privacy_smoke.test.mjs scripts/validate_one_track_evidence.test.mjs
   python3 -m unittest -v scripts/test_one_track_static_contract.py
   node scripts/one_track_browser_privacy_smoke.mjs
   python3 scripts/verify_gate.py
   git diff --check
   ```
10. **Commit message:** `test: add one-track browser privacy harness`

## Task 12: Extend unified verification, immutable root staging, and runbooks

**Objective:** Make the product part of the sole verifier and map its explicit transitive source allowlist to the active Pages root while preserving `/enroll/` and the frozen Gate 1 source/evidence identity.

**Files:**

- Modify: `scripts/stage_pages.py`
- Modify: `scripts/test_stage_pages.py`
- Modify: `scripts/verify_gate.py`
- Modify: `scripts/test_verify_gate.py`
- Modify: `scripts/test_static_contract.py`
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`
- Modify: `prototype/one-track/README.md`
- Create: `docs/validation/milestone-2-one-track-protocol.md`
- Create: `docs/validation/milestone-2-one-track-pr-body.md`

**Steps:**

1. RED-test new ordered verifier stages: `one-track-static-contract`, `one-track-module-import`, `one-track-node-tests` (including golden journey), `one-track-harness-tests`, `one-track-evidence-validator-tests`, `one-track-browser-privacy`, then `pages-staging`. Require exact rerun/fix lines and fail-fast behavior.
2. RED-test mapping only the fixed source→destination tuple below to the Pages root, placeholder replacement in root HTML and every executable module, no recursive copying or graph-discovered addition, no source/test/README/private media outside the tuple, and atomic failure on mixed/malformed identity. Parse imports and require the transitive production import graph to equal—not merely be contained by—the 18-module tuple; require the staged root file set to equal all 20 destinations exactly.
3. RED-test exact `/enroll/` preservation plus no edits under `spikes/001-mobile-web-audio-gate/` or `tools/m2-enrollment/`; continue validating every Gate 1 source file against the accepted manifest even though Gate 1 is no longer the staged root.
4. RED-test that `src/replay/replay-session.mjs`, `src/audio/offline-handoff-renderer.mjs`, every test/fake/fixture, source map, report, log, README, local artifact, and audio extension is absent. The existing `/enroll/` stager retains its own exact allowlist and may render only its approved build placeholder; metadata is the product runtime `.mjs` authority, never duplicate JSON.
5. RED-test workflow behavior: define `CANDIDATE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}`; `verify-and-stage` checks out that exact ref with `fetch-depth: 0` and `persist-credentials: false`, then runs `python3 scripts/stage_pages.py "$CANDIDATE_SHA" _site`; PRs use their head SHA rather than the synthetic merge SHA; only push to `main` deploys its `github.sha`; pinned actions and existing least privilege remain. Require one privacy-safe summary: `PASS staged Pages artifact build=<40-hex> root=one-track enroll=preserved files=33 audio=0`.

   | Source | Staged destination |
   |---|---|
   | `prototype/one-track/index.html` | `index.html` |
   | `prototype/one-track/styles.css` | `styles.css` |
   | `prototype/one-track/src/track-metadata.mjs` | `src/track-metadata.mjs` |
   | `prototype/one-track/src/build-identity.mjs` | `src/build-identity.mjs` |
   | `prototype/one-track/src/config.mjs` | `src/config.mjs` |
   | `prototype/one-track/src/core/run-context.mjs` | `src/core/run-context.mjs` |
   | `prototype/one-track/src/core/tap-estimator.mjs` | `src/core/tap-estimator.mjs` |
   | `prototype/one-track/src/core/handoff-planner.mjs` | `src/core/handoff-planner.mjs` |
   | `prototype/one-track/src/core/effects.mjs` | `src/core/effects.mjs` |
   | `prototype/one-track/src/core/session-reducer.mjs` | `src/core/session-reducer.mjs` |
   | `prototype/one-track/src/core/evidence-schema.mjs` | `src/core/evidence-schema.mjs` |
   | `prototype/one-track/src/audio/audio-math.mjs` | `src/audio/audio-math.mjs` |
   | `prototype/one-track/src/audio/percussion-buffer.mjs` | `src/audio/percussion-buffer.mjs` |
   | `prototype/one-track/src/audio/web-audio-engine.mjs` | `src/audio/web-audio-engine.mjs` |
   | `prototype/one-track/src/browser/local-track-loader.mjs` | `src/browser/local-track-loader.mjs` |
   | `prototype/one-track/src/browser/loaded-session.mjs` | `src/browser/loaded-session.mjs` |
   | `prototype/one-track/src/browser/clock-adapter.mjs` | `src/browser/clock-adapter.mjs` |
   | `prototype/one-track/src/browser/coordinator.mjs` | `src/browser/coordinator.mjs` |
   | `prototype/one-track/src/browser/renderer.mjs` | `src/browser/renderer.mjs` |
   | `prototype/one-track/src/browser/main.mjs` | `src/browser/main.mjs` |
6. **RED command:**

   ```bash
   python3 -m unittest -v scripts/test_stage_pages.py scripts/test_verify_gate.py scripts/test_static_contract.py scripts/test_one_track_static_contract.py
   ```

   Expected: FAIL because product stages/allowlist/runbooks are not wired.
7. Extend the stager and verifier minimally. The only public application paths are the Milestone 2 root `/` and preserved bootstrap `/enroll/`; do not stage a duplicate `/prototype/one-track/` application.
8. Split README prerequisites explicitly: **Local** explains how to install/select Python 3.13.7 and Node v22.22.3 and runs the Section 5 fresh-clone checks; **CI** states that pinned `actions/setup-python`/`actions/setup-node` provide `python3`/`node` with no `/usr/local/bin` assumption; **Task 11 browser** lists the accepted Chrome paths and exact preflight before browser commands. Document the source directory, seven exact root run URLs (`/?run=session-1`…`session-5` and both smokes), exact verifier output, cache-busted deployment-identity preflight, deployed smoke command/expected build, evidence-validator command, evidence naming, privacy rules, and recovery. Add runbook tables for every evidence-validator and browser-smoke closed code: meaning, likely cause, exact isolated rerun, exact recovery, evidence-preservation/stop rule. Test that sensitive filename/path/URI/byte/exception/base-URL/profile-path sentinels cannot appear in direct child output or the unified verifier's `CAUSE` line. Create the reviewed PR body file with summary, baseline SHA placeholder supplied externally at PR creation, test evidence, privacy boundary, staging identity, and explicit human merge/Pixel gates.
9. **Focused GREEN:** rerun the RED command; expect PASS.
10. **Full verification:**

    ```bash
    python3 scripts/verify_gate.py
    TMP_SITE=$(mktemp -d)/site
    python3 scripts/stage_pages.py "$(git rev-parse HEAD)" "$TMP_SITE"
    test -f "$TMP_SITE/index.html"
    test -f "$TMP_SITE/enroll/index.html"
    test -z "$(find "$TMP_SITE" -type f \( -iname '*.mp3' -o -iname '*.wav' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.flac' -o -iname '*.ogg' -o -iname '*.opus' \) -print -quit)"
    git diff --check
    ```

    Expected: unified gate PASS; the Milestone 2 root and `/enroll/` exist; no duplicate product path or audio is staged; Gate 1 source hashes still pass.
11. **Commit message:** `build: verify and stage one-track prototype`

## Task 13: Final independent review, green PR, and publication stop

**Objective:** Review the exact candidate, push one green immutable PR, and stop before the human-owned merge/publication and private-file acceptance protocol.

**Files:**

- Modify only if a verified review finding requires it: files from Tasks 1–12
- No private fixture or protocol evidence; no plan/design changes after the reviewed documentation baseline

**Steps:**

1. **Review RED/precondition:** run:

   ```bash
   git status --short
   git diff --check
   python3 scripts/verify_gate.py
   ```

   Expected before review completion: clean task commits, no whitespace errors, unified gate PASS. Any failure is a blocker, not a waiver.
2. Obtain independent spec-compliance, code-quality, privacy/security, accessibility, and deployment reviews of the full diff against `main`. Review pure policy separately from adapter effects and staged artifact contents.
3. Fix each verified finding with a new focused failing regression first; run its RED, implement, run focused GREEN, then rerun the unified gate. Do not change tuning or product policy during review.
4. Resolve and prove the unique reviewed baseline, frozen plan/design, and protected source paths:

   ```bash
   test "$(git log --format='%H' --grep='^docs: approve milestone 2 implementation plan$' --all | wc -l | tr -d ' ')" = 1
   BASELINE=$(git log --format='%H' --grep='^docs: approve milestone 2 implementation plan$' --all)
   git diff --exit-code "$BASELINE"...HEAD -- docs/design docs/plans/2026-07-27-milestone-2-one-track-vertical-slice.md
   git diff --exit-code main...HEAD -- spikes/001-mobile-web-audio-gate tools/m2-enrollment
   ```

5. Push and open the immutable reviewed PR with no merge:

   ```bash
   HEAD_SHA=$(git rev-parse HEAD)
   BASELINE=$(git log --format='%H' --grep='^docs: approve milestone 2 implementation plan$' --all)
   git push -u origin feat/m2-one-track-vertical-slice

   PR_BODY=$(mktemp)
   python3 -c 'from pathlib import Path; import sys; s=Path(sys.argv[1]).read_text(); Path(sys.argv[2]).write_text(s.replace("@BASELINE@", sys.argv[3]).replace("@HEAD_SHA@", sys.argv[4]))' \
     docs/validation/milestone-2-one-track-pr-body.md "$PR_BODY" "$BASELINE" "$HEAD_SHA"
   gh pr create --base main --head feat/m2-one-track-vertical-slice \
     --title "Milestone 2 one-track tap-to-handoff vertical slice" \
     --body-file "$PR_BODY"
   rm -f "$PR_BODY"

   PR_NUMBER=$(gh pr view --json number --jq .number)
   test "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" = "$HEAD_SHA"
   gh pr checks "$PR_NUMBER" --watch --fail-fast
   ```

6. **Focused verification:** resolve the exact PR-head workflow and require its fixed stage summary; all checks PASS and no PR deployment occurs:

   ```bash
   RUN_ID=$(gh run list --workflow deploy-pages.yml --commit "$HEAD_SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
   test -n "$RUN_ID"
   gh run view "$RUN_ID" --log | grep -F "PASS staged Pages artifact build=$HEAD_SHA root=one-track enroll=preserved files=33 audio=0"
   ```
7. **Full verification:**

   ```bash
   python3 scripts/verify_gate.py
   git diff --check
   ```
8. **Commit message if review fixes are needed:** `fix: address one-track final review findings` (no empty review-only commit).
9. **Autonomy stop:** report the exact PR/head SHA, review results, checks, and staged-artifact identity. Wait for Tony to merge before Task 14.

## Task 14: Run the target Pixel manual gate and record PASS or STOP

**Objective:** On the accepted Pixel and exact deployed build, run the complete fixed ten-slot protocol and two cancellation smokes, then record an honest PASS or STOP without autonomous private-file handling.

**Files:**

- Modify: `docs/validation/milestone-2-one-track-protocol.md`
- User-generated local artifacts: sanitized scored artifacts containing exactly ten scored records (normally ten downloads; fewer only when a cold failure embeds its paired warmed auto-failure) plus exactly two cancellation-smoke artifacts; never add private audio

**Steps:**

1. **Publication precondition:** after Tony merges the exact green PR, wait for the exact merge commit's Pages deployment. Verify HTTPS 200/MIME/build coherence for the Milestone 2 root, every root module, and `/enroll/`; then run `node scripts/one_track_browser_privacy_smoke.mjs --base-url https://tonyisup.github.io/bpm-music-match/ --expected-build <merge-sha>` with only the generated exact-size wrong-hash file. Do not select the private MP3.
2. **Manual-gate precondition:** Tony, not an autonomous agent, explicitly authorizes and performs private selection on Pixel 8 Pro, Android 16 build `CP1A.260505.005`, Chrome `150.0.7871.181` or a deliberately documented replacement. Confirm the deployed commit and both identities before selection.
3. **Early-STOP branch:** if publication identity, supported browser/device, private selection, exact local identity/decode/cue validation, or any later fresh-session setup fails before that slot's first accepted tap, stop the entire protocol. Record only one closed operator code (`deployment-preflight`, `device-preflight`, `fixture-preflight`, or `session-setup`) in the private protocol worksheet; never record the filename/path/URI or unknown error text. Do not synthesize missing JSON, do not invoke the complete-corpus validator, and do not combine the partial run with a restart.
4. Otherwise run the exact ten slots in Section 8. Download each slot's evidence before Reset/recovery. Run the two cancellation smokes after all ten scored slots.
5. Record technical/subjective outcomes before expanding detailed diagnostics. Do not upload, send, commit, log, screenshot, or otherwise expose the private MP3; only closed sanitized evidence may leave the phone.
6. If the first complete protocol fails the subjective threshold, a human may authorize exactly one bounded tuning cycle under Section 9. Any tuning creates a new config version/build/deployment and restarts all ten slots; old/new trials cannot be mixed.
7. **Focused verification for a complete corpus only:** from a private local directory containing all sanitized downloads produced by the run (nominally twelve files; fewer only when a cold export embeds its paired warmed auto-failure), run `node scripts/validate_one_track_evidence.mjs --dir "$EVIDENCE_DIR"`. Require one `VALID one-track-evidence scored=10 smokes=2 technical=<0..10> intentional=<0..10> decision=PASS|STOP` line consistent with the evidence; the validator must not echo the directory or unknown values. This validates closed schemas, build/asset/config consistency, slot order, five cold/five warmed records, 4/3/3 class totals, denominator rules, paired auto-failure if any, and two distinct smoke records. An early STOP is complete only through the closed worksheet code and deliberately has no validator result.
8. **Full verification:**

   ```bash
   python3 scripts/verify_gate.py
   git diff --check
   ```

   Also manually require every acceptance item in Section 8.
9. Write the exact PASS or STOP result and immutable build SHA/device/browser. For a complete corpus, also record evidence inventory/digests, technical count, intentional count, edge adjudication, cancellation outcomes, defects, and whether the bounded tuning cycle was used. For an early STOP, record only the closed operator code and that no complete corpus exists. Do not include private filenames/paths/URIs/content.
10. **Commit message:** `docs: record milestone 2 Pixel verdict`
11. Stop. Even a Milestone 2 PASS does not authorize provider work or field-workout implementation; those require their separately approved gates.

---

## 6. Explicit exclusions

Do not add or plan around:

- npm packages, frameworks, bundlers, transpilers, WASM, Tone.js, or media-element playback;
- backend, APIs, remote config, runtime fetch, telemetry, analytics, crash reporting, upload, or remote logs;
- service worker, PWA/install shell, Cache Storage, IndexedDB, localStorage, sessionStorage, cookies, or persisted track/evidence state;
- providers, catalogs, playlists, accounts, search, recommendation, multiple tracks, or generalized matching;
- automatic BPM/beat/downbeat/key analysis, audio fingerprinting, half/double-time matching, time stretch, pitch shift, normalization scan, limiter, or adaptive mastering;
- accelerometer, heart rate, movement sensing, background playback, workout programming, or field reseeding behavior;
- seamless same-tap reseeding; during Milestone 2 a handoff/playing tap cancels only;
- private file bytes, samples, filename, path, URI, object URL, artwork, metadata strings, or test copies;
- edits to frozen Gate 1, `/enroll/`, the approved design after Task 1 fixture closure, or existing accepted evidence;
- any deployment from a PR or any merge not performed/authorized by Tony;
- claims about Chrome decoder/native/process heap release; `browserHeapObserved` stays `false`.

## 7. Abort and escalation gates

Stop immediately and report rather than broadening or guessing if any occurs:

### Before or during implementation

- A pre-implementation reviewer leaves an unresolved blocker/high finding.
- A task cannot demonstrate the expected RED before production code.
- Core imports a browser/storage/network global, or Web Audio makes a policy decision.
- Any private-derived value appears in source, tests, logs, errors, DOM, evidence, staging, git status, or request traffic.
- Any request after startup settles and tripwires arm before picker enablement, or any persistence operation, is observed. Allowlisted public startup HTML/CSS/module requests are not a violation.
- `spikes/001-mobile-web-audio-gate/`, `tools/m2-enrollment/`, or the approved design after Task 1 fixture closure changes.
- Staged `/enroll/` differs from its expected bytes, Gate 1 source hashes differ, or the staged root is not the exact reviewed Milestone 2 graph.
- Transaction rollback leaks a source/context/timer, evidence can be lost before download, or stale callbacks mutate current state.
- `python3 scripts/verify_gate.py`, privacy smoke, module identity, or staging allowlist fails.
- Three correction cycles do not converge on a review/test failure.

### Before target Pixel use

- The exact reviewed merge SHA is not deployed and visible in HTML/all modules.
- The root does not identify the exact reviewed Milestone 2 merge or `/enroll/` behavior changed.
- Synthetic browser/privacy/offline/replay/lifecycle verification is not fully green.
- Console errors, mixed cached identities, unexpected requests, or a service worker are present.
- The device/browser differs without deliberate protocol documentation.
- Any autonomous agent would need direct access to the private file. Stop and hand control to Tony.

### During the protocol

- Build, asset identity, config identity, track annotation, gains, percussion, curve, or acceptance window changes. Invalidate the run and restart under a new version after review.
- Evidence is not downloaded before Reset/recovery. Mark `evidence-missing`; do not recreate or cherry-pick.
- A post-first-tap technical failure occurs. Score the slot failed; do not retry it away.
- A cold application teardown makes warmed state unavailable. Auto-fail the paired warmed slot; never relabel a replacement load as warmed.
- A handoff estimate lands outside the assigned slot class. Score failure even if inside app match window.
- More than two pre-handoff no-match retries would be needed. Third no-match is the scored slot failure.
- The private MP3 would need upload, commit, transfer, or agent access. Abort.

## 8. Complete target Pixel acceptance protocol

### Fixed target and qualification ranges

Use the exact deployed build, `m2-island-party-v1`, `m2-config-v1`, and `B = 110`. Matching and class assignment use frozen unrounded `estimatedBpmExact`.

```text
CENTER:    109.25 <= estimate <= 110.75
LOW_EDGE:  107.00 <= estimate <= 107.75
HIGH_EDGE: 112.25 <= estimate <= 113.00
APP MATCH: 107.00 <= estimate <= 113.00
```

Estimates in class gaps may be valid app matches but fail the assigned protocol slot if a handoff occurs. Estimates outside app match must produce **No match in this one-track test**.

### Preflight

1. Use Pixel 8 Pro, Android 16 `CP1A.260505.005`, Chrome `150.0.7871.181`, unless a replacement is deliberately recorded.
2. Close other audio, disable battery/audio effects that were not present in Gate 1, set safe media volume, use a quiet stationary listening environment, and keep the page foregrounded.
3. Open the exact fixed root run URL for the current session in a fresh tab, for example `/?run=session-3`. Confirm the read-only session/slot/class line, full build SHA, asset/config versions, no console error, and no service worker/controller. Never edit query values mid-session.
4. Keep the private MP3 on the phone. Never upload/send it. Select it only through the app's local picker.
5. Before every private selection, run this on the operator machine with the reviewed merge SHA, then open/reload the fixed run URL only after it passes:

   ```bash
   EXPECTED_SHA="${EXPECTED_SHA:?export EXPECTED_SHA as the reviewed 40-hex merge SHA}"
   printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'
   IDENTITY=$(curl -fsS -H 'Cache-Control: no-cache' \
     "https://tonyisup.github.io/bpm-music-match/src/build-identity.mjs?v=$EXPECTED_SHA")
   ACTUAL_SHA=$(printf '%s\n' "$IDENTITY" | \
     python3 -c 'import re,sys; s=sys.stdin.read(); m=re.search(r"^export const BUILD_SHA = [\"\x27]([0-9a-f]{40})[\"\x27];$", s, re.M); print(m.group(1) if m else "")')
   test "$ACTUAL_SHA" = "$EXPECTED_SHA"
   ```

   The app must then reach `ready` after exact identity/decode/cue validation. A setup failure stops before scored trials.
6. Prepare the external worksheet. Write subjective verdict and audible defects before opening detailed diagnostics.

### Per-attempt and per-slot rules

1. A slot begins at its first accepted physical tap under the app's immutable run-derived session/slot/assigned class.
2. Tap steadily while stationary, require one audible composite acknowledgment for every physical tap, then stop. No Lock button is used.
3. Before handoff, a clean `no-match` is `cadence-unqualified`; Try again up to two times. The third no-match scores one technical failure.
4. Any post-first-tap app error, missing/double beat, click, gap, clipping, stale audio, ownership/teardown failure, wrong-class handoff, or reload is the slot's immediate scored failure.
5. A class-valid handoff is the scored take whether intentional or mechanical. Never replace it.
6. Listen through beat 9 song-only. Use End trial only at/after beat 9 unless natural end occurs.
7. Before diagnostics, answer **“Did the song feel hidden inside the taps?”** with `intentional` or `mechanical`; use `not-judged` only when technical failure prevented audible handoff. Record every required defect boolean, including missing/doubled acknowledgment and audible clipping, before Download enables.
8. Download sanitized evidence. Until download completes, do not Reset, Choose, Reload, Unload, or leave.
9. Cold means fresh page load and one successful local selection/decode with no prior handoff in that page. Warmed means the immediately following slot after resolved cold evidence and Reset retaining the same decoded session.
10. If cold failure destroys the loaded session, its evidence auto-records the paired warmed slot `paired-session-unavailable`, `technicalPass=false`, `not-judged`. Continue at the next numbered fresh session.

### Ten fixed scored slots

| Session | Slot | Thermal state | Assigned class | Fixed run URL / required setup |
|---:|---:|---|---|---|
| 1 | 1 | Cold | CENTER | `/?run=session-1`; fresh page; select/validate track; run; answers; download. |
| 1 | 2 | Warmed | LOW_EDGE | Reset only after Slot 1 download; retain same buffer/context; run; verdict; download; unload/close session. |
| 2 | 3 | Cold | HIGH_EDGE | `/?run=session-2`; fresh page/selection/decode; run; answers; download. |
| 2 | 4 | Warmed | CENTER | Reset after Slot 3 download; run; verdict; download; unload/close. |
| 3 | 5 | Cold | LOW_EDGE | `/?run=session-3`; fresh page/selection/decode; run; answers; download. |
| 3 | 6 | Warmed | HIGH_EDGE | Reset after Slot 5 download; run; verdict; download; unload/close. |
| 4 | 7 | Cold | CENTER | `/?run=session-4`; fresh page/selection/decode; run; answers; download. |
| 4 | 8 | Warmed | LOW_EDGE | Reset after Slot 7 download; run; verdict; download; unload/close. |
| 5 | 9 | Cold | HIGH_EDGE | `/?run=session-5`; fresh page/selection/decode; run; answers; download. |
| 5 | 10 | Warmed | CENTER | Reset after Slot 9 download; run; verdict; download; unload/close. |

Fixed totals: four CENTER, three LOW_EDGE, three HIGH_EDGE; five cold and five warmed. The denominator remains ten. No reordering, replacement, or cherry-picking.

### Two separate cancellation smokes (not in the 8/10 denominator)

After the ten slots, use the same exact build/config/fixture. Each smoke starts from its own fresh fixed URL and requires a fresh private selection/decode before reaching `ready`:

1. **Crossfade cancellation smoke:** open `/?run=smoke-crossfade`, select/validate the track, establish a center-class handoff, and during beats 4–8 tap once. Require click-free 20/25 ms stop, no delayed tail, no doubled acknowledgment, no stale source/restart, and prove the cancelling tap was not reused. Wait for visible `ready`, then tap once: require a distinct new generation and one normal composite acknowledgment. The app automatically ramps and settles that smoke-probe generation, then enters `evidence-pending`. Record the five human observations, Download, then Reset/reload.
2. **Playing cancellation smoke:** open `/?run=smoke-playing`, select/validate the track, establish another center-class handoff, and at/after beat 9 tap once. Require the same click-free stop, no tail/double acknowledgment/stale restart, and no cancelling-tap reuse. Wait for visible `ready`, then tap once: require a distinct new generation and one normal composite acknowledgment. After automatic bounded probe cleanup reaches `evidence-pending`, record observations, Download, then Reset/reload.

A failure in either smoke makes Milestone 2 STOP even if the ten scored handoffs meet perceptual thresholds.

### Acceptance decision

PASS requires all of:

- `10/10` scored handoffs technically complete;
- at least `8/10` scored handoffs judged `intentional`;
- one audible acknowledgment per physical tap and no missing/doubled acknowledgment through beat 9;
- no missing/doubled beat from final physical tap through beat 9;
- no clipping, click, gap, stale-generation audio, or source/teardown leak;
- LOW_EDGE and HIGH_EDGE results explicitly adjudicate whether snap feels mechanical;
- all evidence files present, schema-valid, and tied to one build/asset/config;
- both cancellation smokes pass.

Otherwise record STOP, subject only to the one bounded tuning cycle below.

## 9. One bounded tuning cycle

If and only if the first complete ten-slot protocol is technically valid but fewer than eight handoffs feel intentional, one human-approved tuning cycle may change only:

- percussion timbre within the versioned recipe;
- target-entry downbeat annotation;
- lead-in position;
- crossfade duration/curve;
- fixed percussion/track/master trims;
- fixed acceptance window only when edge snap is the diagnosed cause.

Every change requires a new `configVersion`, fresh tests/reviews, a new immutable deployment, identity confirmation, and a complete restart of all ten slots plus both smokes. Never mix evidence between builds/configs. If the second complete protocol fails, STOP and reassess; do not add tracks, providers, personalization, analysis, or visual polish.

## 10. Completion checklist and unresolved decisions

Implementation is complete only when:

- [ ] pre-implementation five-review gate approves this plan;
- [ ] Tasks 1–12 landed in strict RED/GREEN order with focused and full verification;
- [ ] pure core owns all policy and adapters own all effects/resources;
- [ ] Web Audio consumes only recursively frozen validated plans;
- [ ] synthetic/replay/offline/browser/privacy/lifecycle/staging tests pass;
- [ ] unified verifier and PR checks pass on the exact reviewed SHA;
- [ ] `/enroll/` is preserved, Gate 1 source hashes remain accepted, and `/` is the exact reviewed Milestone 2 graph;
- [ ] no duplicate `/prototype/one-track/` public application is staged;
- [ ] Task 13 PR verification/staging passes and autonomy stops before merge;
- [ ] Tony explicitly authorizes and performs Task 14 private-file/Pixel protocol;
- [ ] ten evidence slots and two smokes validate against one build/asset/config;
- [ ] PASS or STOP is documented without private data;
- [ ] field gate and provider work remain separate.

**Unresolved product decisions:** None. The approved design is normative. Implementation details in this plan are selected only to execute that design; any newly discovered product-policy ambiguity is an abort/escalation condition, not permission to improvise.
