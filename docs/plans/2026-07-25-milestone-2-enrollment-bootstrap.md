# Milestone 2 Local Enrollment Bootstrap Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task with strict red-green-refactor cycles, spec review, and code-quality review.

**Goal:** Add a bounded `/enroll/` GitHub Pages utility that lets Tony select one local MP3 on the Pixel, derives the complete privacy-safe Milestone 2 stimulus fixture in browser memory, and leaves the existing Milestone 1 root artifact unchanged.

**Architecture:** Keep enrollment isolated under `tools/m2-enrollment/`. Pure validation/report helpers receive explicit byte/decode inputs; browser adapters own File API, Web Crypto, and Web Audio. Candidate choices live in a repo-level JSON config. The page fetches only that fixed config before selection; no file-derived value can reach a network, persistence, or logging API. Two explicit select/load/unload cycles must end with all application-owned resource counters at zero before the final report becomes copyable/downloadable.

**Tech Stack:** Native HTML/CSS/ES modules, Web Crypto, raw Web Audio, Node 22 built-in test runner, Python 3.13 static-contract tests, GitHub Pages.

---

## Approved bootstrap boundary

This utility is a documented exception to the Milestone 2 implementation-planning entry gate because the approved design requires enrollment facts that only browser code can observe. It is not the Milestone 2 product runtime.

Allowed:

- one configured candidate label, BPM hypothesis, extension, and percussion recipe;
- local File API byte reads after a hard compressed-size check;
- SHA-256, full decode, bounded start/end/cue sample inspection, and raw Web Audio preview;
- sanitized JSON output and explicit user-initiated download;
- application-owned resource counters for two load/unload cycles.

Forbidden:

- upload, analytics, backend, service worker, Cache Storage, IndexedDB, local/session storage;
- reporting filename, path, local/object URI, bytes, samples, or audio content;
- automatic BPM, beat, or downbeat detection;
- changing the Milestone 1 root source or its deployed build identity;
- treating the candidate BPM as verified without Tony's explicit confirmation.

## Gates

- **Pre-flight:** exact runtime versions, authenticated GitHub CLI, clean approved-design worktree, and unchanged Gate 1 source hashes.
- **Revision:** every implementation task must pass spec review and code-quality review; maximum three correction cycles.
- **Abort:** any evidence that private file-derived data can reach network/persistence/logging, or that the root artifact changes.
- **Escalation:** only if the selected MP3 fails fixed memory/decode/cue constraints or Android Chrome exposes behavior not represented by the tested browser boundary.

## Task 1: Pure enrollment contracts

**Objective:** Implement deterministic limits, timing checks, cue-energy math, sanitized identity construction, and lifecycle-counter evaluation.

**Files:**

- Create: `tools/m2-enrollment/enrollment-core.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-core.test.mjs`

**RED:** Tests define:

- 20 MiB compressed limit before byte reads;
- duration 0–360 seconds, 1–2 channels, 8–96 kHz sample rate, and PCM ≤160 MiB;
- `targetEntryDownbeatSeconds >= 4 * (60 / BPM)`;
- target downbeat plus three beat durations plus two seconds fits within decoded duration;
- 50 ms cue RMS/peak thresholds (`0.010`, `0.050`);
- report key allowlist excludes filename/path/URI/bytes/samples;
- final memory compliance requires two completed unloads and all counters at zero.

Run and expect failure because the module is absent:

```bash
node --test tools/m2-enrollment/tests/enrollment-core.test.mjs
```

**GREEN:** Add only the pure exported helpers required by the tests, then rerun the focused test.

## Task 2: Browser analysis and teardown boundary

**Objective:** Read, hash, decode, inspect, preview, and unload the local file without leaking private values.

**Files:**

- Create: `tools/m2-enrollment/enrollment-browser.mjs`
- Create: `tools/m2-enrollment/tests/enrollment-browser.test.mjs`
- Create: `tools/m2-enrollment/tests/fake-audio.mjs`

**RED:** Tests define:

- size is rejected before `arrayBuffer()`;
- lowercase SHA-256 is computed before decode;
- raw bytes are dereferenced after hash/decode settlement;
- bounded start/end and cue windows are inspected without full-track iteration;
- preview uses an owned `AudioBufferSourceNode`, never a media element;
- object/file URLs are never created;
- unload stops preview, clears decoded/raw references, closes the context, clears the file input, and returns counters to zero;
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
- Create: `tools/m2-enrollment/enrollment-config.json`
- Create: `tools/m2-enrollment/tests/app.test.mjs`
- Create: `scripts/test_enrollment_static_contract.py`

**Configured candidate:**

```json
{
  "schemaVersion": 1,
  "assetVersion": "m2-island-party-v1",
  "displayLabel": "Island Party by NDA",
  "expectedExtension": ".mp3",
  "trackBpmHypothesis": 110,
  "trackBpmVerified": false,
  "beatsPerBar": 4,
  "percussionRecipeId": "kick-snare-v1"
}
```

**RED:** Tests define:

- one labeled audio file input with `.mp3,audio/mpeg` acceptance;
- a numeric downbeat input, Raw Web Audio preview controls, Use preview time, Analyze cue, Unload, Copy report, and Download report;
- final report remains disabled until two matching-SHA load/unload cycles complete and BPM is explicitly confirmed;
- mismatch on cycle two resets enrollment instead of merging identities;
- copy/download output uses the sanitized report allowlist;
- config loads from exactly `./enrollment-config.json` before selection;
- no XHR, WebSocket, EventSource, sendBeacon, storage, service worker, object URL, form submission, media element, or file-derived fetch path exists;
- filename is never rendered or logged;
- mobile accessibility: one H1, associated labels, 48×56 px controls, focus-visible treatment, live status, safe-area padding, reduced-motion rule.

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
- Modify: `scripts/verify_gate.py`
- Modify: `scripts/test_verify_gate.py`
- Modify: `scripts/test_static_contract.py`
- Modify: `.github/workflows/deploy-pages.yml`

**RED:** Tests define:

- stage script copies only the existing Gate 1 allowlist to `/` and enrollment allowlist to `/enroll/`;
- root build placeholders resolve to accepted Gate 1 SHA `11df30f6f6cf90940bee425847614abaf26cc6f1`;
- enrollment placeholders resolve to the deploying feature SHA;
- staged root files byte-match a fixture generated from the accepted Gate 1 source and SHA;
- no private audio extensions are staged under `/enroll/`;
- unified verifier includes enrollment Python tests, enrollment Node tests, module imports, and staging tests;
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
4. Push `feat/m2-enrollment-bootstrap`.
5. Run the Pages workflow for that exact branch/commit and wait for success.
6. Verify live `/` still identifies Gate 1 commit `11df30f6…` and retains its original controls.
7. Verify live `/enroll/` identifies the feature commit, exposes the file picker, and produces no console errors.
8. Dynamically import the deployed analyzer and exercise real Web Crypto/Web Audio decode against the public generated Gate 1 WAV as a non-private browser smoke.
9. Stop before claiming Pixel enrollment complete; Tony performs the private-file run on the accepted Android device.
