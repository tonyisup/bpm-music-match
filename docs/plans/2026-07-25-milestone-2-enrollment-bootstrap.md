# Milestone 2 Local Enrollment Bootstrap Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task with strict red-green-refactor cycles, spec review, and code-quality review.

**Goal:** Add a bounded `/enroll/` GitHub Pages utility that lets Tony select one local MP3 on the Pixel, derives the complete privacy-safe Milestone 2 stimulus fixture in browser memory, and leaves the existing Milestone 1 root artifact unchanged.

**Architecture:** Keep enrollment isolated under `tools/m2-enrollment/`. Pure validation/report helpers receive explicit byte/decode inputs; browser adapters own File API, Web Crypto, and Web Audio. Candidate choices live in a validated static ESM config so the page can enforce `connect-src 'none'`. A tokenized state machine owns one load or preview at a time and discards late async settlements. Two explicit select/load/unload cycles must close their contexts and clear every application-owned reference before the final report becomes copyable/downloadable; the report makes no browser/native heap-release claim.

**Tech Stack:** Native HTML/CSS/ES modules, Web Crypto, raw Web Audio, Node 22 built-in test runner, Python 3.13 static-contract tests, GitHub Pages.

---

## Approved bootstrap boundary

This utility is a documented exception to the Milestone 2 implementation-planning entry gate because the approved design requires enrollment facts that only browser code can observe. It is not the Milestone 2 product runtime.

Allowed:

- one configured candidate label, BPM hypothesis, extension, and percussion recipe;
- local File API byte reads after a hard compressed-size check;
- SHA-256, full decode, bounded start/end/cue sample inspection, and raw Web Audio preview;
- sanitized JSON output and explicit user-initiated download;
- application-owned cleanup facts for two load/unload cycles, explicitly distinguished from browser/process memory.

Forbidden:

- upload, analytics, backend, service worker, Cache Storage, IndexedDB, local/session storage;
- reporting filename, path, local/object URI, bytes, samples, or audio content;
- automatic BPM, beat, or downbeat detection;
- changing the Milestone 1 root source or its deployed build identity;
- treating the candidate BPM as verified without Tony's explicit confirmation.

## Gates

- **Pre-flight:** exact runtime versions, authenticated GitHub CLI, clean approved-design worktree, and unchanged Gate 1 source hashes.
- **Revision:** every implementation task must pass spec review and code-quality review; after three non-converging correction cycles, stop and escalate rather than accepting unresolved findings.
- **Abort:** any evidence that private file-derived data can reach network/persistence/logging, or that the root artifact changes.
- **Escalation:** only if the selected MP3 fails fixed memory/decode/cue constraints or Android Chrome exposes behavior not represented by the tested browser boundary.

## Task 1: Pure enrollment contracts

**Objective:** Implement deterministic limits, timing checks, cue-energy math, sanitized identity construction, and lifecycle-counter evaluation.

**Architecture:** Split the pure contracts by responsibility: measurements own bounded byte/decode/timing/cue math, reports own the closed schema and serialization, and lifecycle owns opaque application-memory evidence. `enrollment-core.mjs` remains only a seven-name legacy compatibility facade; new browser code imports `createApplicationMemoryEvidence` directly from the lifecycle module. The internal frozen measurement-limit object used for report cross-field validation is not re-exported there.

**Files:**

- Create: `tools/m2-enrollment/enrollment-core.mjs`
- Create: `tools/m2-enrollment/enrollment-measurements.mjs`
- Create: `tools/m2-enrollment/enrollment-report.mjs`
- Create: `tools/m2-enrollment/enrollment-lifecycle.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-measurements.test.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-report.test.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-lifecycle.test.mjs`

**RED:** Tests define:

- 20 MiB compressed limit before byte reads;
- duration greater than 0 and at most 360 seconds, 1–2 integer channels, integer 8–96 kHz sample rate, and exact frame-based PCM ≤160 MiB;
- `targetEntryDownbeatSeconds >= 4 * (60 / BPM)`;
- target downbeat plus three beat durations plus two seconds fits within decoded duration;
- 50 ms cue RMS/peak thresholds (`0.010`, `0.050`);
- report constructor accepts separated `trustedConfig`, `observedAssetFacts`, and curated downbeat inputs; it validates a closed config shape and constructs every output string/fixed policy value from that object, while Task 3 integration tests must prove the object came directly from static config and that file-derived input reaches only configured extension/MIME equality checks, SHA, and bounded numeric facts;
- static policy is exact: schema `1`, `.mp3`/`audio/mpeg`, duration tolerance `0.050`, 4/4, four lead-in beats, two-second tail, gains `0.25/0.50/0.70`, BPM window `3.0`, outlier fraction `0.20`, CV `0.05`, reconciliation `60 ms`, beat-4/5/8 crossfade, 128 samples, and versioned formula/curve IDs;
- report key allowlist excludes filename/path/URI/bytes/samples and rejects all observed extra strings or nested values;
- report serialization accepts only reports branded by the constructor, reconstructs the exact export DTO with null prototypes, and uses the serializer captured when the report module evaluated, so later ordinary same-realm prototype pollution or `JSON.stringify` replacement cannot add file-derived fields;
- application cleanup requires exactly two matching lowercase-64-hex-SHA unloads, successful context closes, all owned references/counters at zero, and `browserHeapObserved: false`; the lifecycle factory snapshots approved direct data properties into private `WeakMap` state and the evaluator accepts only its opaque branded evidence;
- decoded metadata observation consistency is one sample frame (plus floating-point noise), distinct from the enrolled `0.050`-second runtime identity tolerance;
- threat boundary: the selected file supplies bytes to browser hashing/decoding and bounded scalar observations to these pure contracts, never executable object graphs. This does not claim protection from a malicious extension or other code that compromised the same realm before the modules evaluated.

Run and expect failure because the module is absent:

```bash
node --test tools/m2-enrollment/tests/enrollment-measurements.test.mjs
node --test tools/m2-enrollment/tests/enrollment-report.test.mjs
node --test tools/m2-enrollment/tests/enrollment-lifecycle.test.mjs
```

**GREEN:** Add only the pure exported helpers required by the tests, preserve the compatibility facade's exact public names and function identities, then rerun every focused split test.

## Task 2: Browser analysis and teardown boundary

**Objective:** Read, hash, decode, inspect, preview, and unload the local file without leaking private values.

**Files:**

- Create: `tools/m2-enrollment/enrollment-browser.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-browser.test.mjs`
- Create: `tools/m2-enrollment/tests/fake-audio.mjs`

**RED:** Tests define:

- size is rejected before `arrayBuffer()`;
- lowercase SHA-256 is computed before decode;
- exactly one tokenized load is active, with one 15-second aggregate hash/decode deadline;
- Cancel invalidates the token and blocks replacement until teardown settles; late hash/decode results are discarded and their context is closed;
- raw bytes are dereferenced after hash/decode settlement and the file input is cleared in a read-stage `finally` on success, cancellation, and failure;
- bounded start/end and cue windows use `copyFromChannel()` into fixed scratch arrays; no full-channel view/subarray is retained;
- preview uses one owned, one-shot `AudioBufferSourceNode`, never a media element; each direct Play gesture performs tokenized `resume()`, settles any old source, and derives position from source offset plus context time;
- object/file URLs are never created;
- Unload, `pagehide`, and foreground loss invalidate loads, stop preview, clear references, and initiate context close; close rejection/timeout is reload-only and cannot count as a successful unload;
- counters decrement only after source/context settlement;
- thrown errors and result objects never contain the selected filename or bytes.

Run and expect failure because the module is absent:

```bash
node --test tools/m2-enrollment/tests/enrollment-browser.test.mjs
```

**GREEN:** Implement the injected browser boundary and rerun focused plus enrollment tests.

## Task 3: Accessible two-cycle enrollment UI

**Objective:** Provide the Pixel workflow and final sanitized fixture report.

**Files:**

- Create: `tools/m2-enrollment/index.html`
- Create: `tools/m2-enrollment/styles.css`
- Create: `tools/m2-enrollment/app.mjs`
- Create: `tools/m2-enrollment/enrollment-config.mjs`
- Create: `tools/m2-enrollment/tests/app.test.mjs`
- Create: `tools/m2-enrollment/tests/fixtures/synthetic-enrollment.mp3`
- Create: `scripts/test_enrollment_static_contract.py`
- Create: `scripts/enrollment_browser_privacy_smoke.mjs`

**Configured candidate:**

```js
export const ENROLLMENT_CONFIG = Object.freeze({
  schemaVersion: 1,
  assetVersion: 'm2-island-party-v1',
  displayLabel: 'Island Party by NDA',
  allowedExtension: '.mp3',
  allowedMimeType: 'audio/mpeg',
  decodedDurationToleranceSeconds: 0.050,
  configVersion: 'm2-config-v1',
  trackBpm: 110,
  trackBpmVerified: false,
  beatsPerBar: 4,
  leadInBeats: 4,
  minimumPostCrossfadeTailSeconds: 2,
  percussionRecipeId: 'kick-snare-v1',
  percussionTrimGain: 0.25,
  trackTrimGain: 0.50,
  masterGain: 0.70,
  bpmMatchWindow: 3.0,
  intervalOutlierFraction: 0.20,
  stabilityCvLimit: 0.05,
  reconciliationToleranceMs: 60,
  silenceTimeoutFormula: 'clamp-1.5x-median-900-1800-v1',
  crossfadeStartBeat: 4,
  targetDownbeatBeat: 5,
  crossfadeEndBeat: 8,
  crossfadeSampleCount: 128,
  crossfadeCurveId: 'equal-power-sin-cos-v1',
});
```

The app passes this statically imported object through a narrow assembly function. That function may change only `trackBpmVerified` from `false` to `true` after Tony explicitly confirms the configured BPM; it must reject every other override. No field read from `File` is accepted into the config object.

**RED:** Tests define:

- one labeled audio file input with `.mp3,audio/mpeg` acceptance;
- observed `File.type` must be exactly `audio/mpeg`; empty or unexpected Android MIME escalates rather than being guessed, and `accept` remains only a picker hint;
- a numeric downbeat input, Raw Web Audio preview controls, Use preview time, Analyze cue, Unload, Copy report, and Download report;
- final report remains disabled until two matching-SHA load/unload cycles complete and BPM is explicitly confirmed;
- mismatch on cycle two resets enrollment instead of merging identities;
- copy output and a user-gesture `data:application/json` download use a closed recursive report schema;
- config imports statically from exactly `./enrollment-config.mjs`; no runtime config request exists; report assembly proves every string/fixed policy field retains direct static-config identity, permits only the explicit `trackBpmVerified` confirmation transition, and rejects attempts to route `File.name`, `File.type`, paths, URIs, or other file-derived strings through config;
- meta CSP sets `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`, and framed execution is rejected as defense in depth;
- no XHR, WebSocket, EventSource, sendBeacon, storage, service worker, object URL, form submission, media element, or file-derived fetch path exists;
- filename is never rendered or logged;
- mobile accessibility: one H1, associated labels, 48×56 px controls, focus-visible treatment, live status, safe-area padding, reduced-motion rule.

The real-browser privacy smoke launches Chrome against a local server, selects the synthetic MP3 through the actual file input using a deliberately sensitive filename, and arms request/console/error/unhandled-rejection tripwires after boot. It drives success, failure, cancel, preview, copy, download, and unload paths and requires zero post-selection requests plus no filename/bytes in DOM, logs, exceptions, clipboard, or downloaded JSON. The fixture is test-only and is never staged publicly.

Run and expect failure because the UI does not exist:

```bash
node --test tools/m2-enrollment/tests/app.test.mjs
python3 -m unittest -v scripts/test_enrollment_static_contract.py
```

**GREEN:** Implement the minimum UI and rerun all enrollment tests.

## Task 4: Unified verification and immutable Pages staging

**Objective:** Verify and deploy `/enroll/` while reproducing the Gate 1 root artifact with its original accepted build identity.

**Files:**

- Create: `scripts/stage_pages.py`
- Create: `scripts/test_stage_pages.py`
- Create: `scripts/gate1-public-manifest.json`
- Modify: `scripts/verify_gate.py`
- Modify: `scripts/test_verify_gate.py`
- Modify: `scripts/test_static_contract.py`
- Modify: `.github/workflows/deploy-pages.yml`

**RED:** Tests define:

- stage script copies only the existing Gate 1 allowlist to `/` and enrollment allowlist to `/enroll/`;
- root build placeholders resolve to accepted Gate 1 SHA `11df30f6f6cf90940bee425847614abaf26cc6f1`;
- enrollment placeholders resolve to the deploying feature SHA;
- every staged root file must byte-match its fixed rendered SHA-256 in `gate1-public-manifest.json` before artifact upload;
- no private audio extensions are staged under `/enroll/`;
- enrollment HTML, every executable module, and static config carry the same deploying SHA and reject mixed cached builds;
- unified verifier includes enrollment Python tests, enrollment Node tests, module imports, browser privacy smoke, and staging tests;
- pull requests run verification/staging without deploy permission or environment; only a push to `main` may enter the existing Pages deployment job;
- workflow uses only the unified verifier and stage script, pinned actions, least privilege, and the explicit artifact directory.

Run and expect failure before staging implementation:

```bash
python3 -m unittest -v scripts/test_stage_pages.py scripts/test_static_contract.py scripts/test_verify_gate.py
```

**GREEN:** Implement staging and verifier changes. Run:

```bash
python3 scripts/verify_gate.py
```

Expected: all Gate 1 and enrollment stages pass.

## Task 5: Documentation and deployment runbook

**Objective:** Make the bootstrap and private-data boundary reproducible.

**Files:**

- Create: `tools/m2-enrollment/README.md`
- Modify: `README.md`
- Modify: `docs/design/2026-07-24-milestone-2-one-track-vertical-slice.md`

Document:

- why the bootstrap exception exists;
- exact `/enroll/` Pixel sequence;
- how to choose/preview and manually confirm the 1:1 BPM/downbeat;
- two load/unload cycles;
- which sanitized JSON may be shared;
- explicit instruction never to upload or send the MP3;
- the enrollment utility does not authorize Milestone 2 product implementation until fixture completion.

Verification:

```bash
python3 scripts/verify_gate.py
git diff --check
```

## Task 6: Review, push, deploy, and live smoke

1. Stage the complete candidate and prove no unstaged/untracked drift.
2. Run independent spec-compliance, privacy/security, and code-quality reviews.
3. Fix only verified findings; rerun the focused and unified gates.
4. Push `feat/m2-enrollment-bootstrap`, open a pull request, and require its non-deploy verification job to pass.
5. Merge the reviewed exact commit to `main`; do not broaden the Pages environment's main-only deployment policy.
6. Wait for the exact `main` merge commit's Pages deployment to succeed.
7. Verify `/enroll` canonical behavior, `/enroll/`, direct module paths, and query-string loads; enrollment identifies the merge commit and has no console errors.
8. Verify live `/` still identifies Gate 1 commit `11df30f6…`, matches the fixed public manifest, and retains its original controls.
9. Run the desktop real-Chrome privacy smoke through the actual file input with the non-private MP3 fixture before merge. The private candidate remains local and is the first target-Pixel MP3/file-picker acceptance run.
10. Stop before claiming Pixel enrollment or browser/native memory release complete; Tony performs the private-file run on the accepted Android device and shares only the closed-schema report.
