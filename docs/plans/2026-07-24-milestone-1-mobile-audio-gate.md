# BPM Music Match Milestone 1 Implementation Plan

> **For Hermes:** Use strict test-driven development. Implement Milestone 1 only. Milestone 2 remains blocked until the deployed real-device audio gate passes.

**Goal:** Build and deploy a mobile-web technical spike that proves one user gesture can unlock a raw Web Audio graph, decode one controlled audio file, schedule percussion and music through independent gain paths, complete a true equal-power crossfade, and cancel cleanly on interruption.

**Architecture:** A small Vite/TypeScript application owns one native `AudioContext`. Pure modules calculate equal-power envelopes and an eight-beat gate schedule; an injected Web Audio engine applies those plans to browser nodes; a reducer-driven UI exposes loading, ready, running, completed, and error states. The app accepts exactly one local audio file for the gate so no copyrighted audio is committed or uploaded.

**Tech Stack:** TypeScript, Vite, Vitest, raw Web Audio API, static HTML/CSS, GitHub Pages-compatible build.

**Source of truth:** `docs/design/approved-design.md`

**Honest baseline:** The repository currently contains only the approved design and project README. It has no package scaffold, runtime code, tests, bundled music, provider integration, or deployment workflow.

---

## Scope Boundary

### Included in Milestone 1

- One local-file picker; the selected file remains in browser memory.
- One native `AudioContext` shared by percussion and music.
- Decode-before-enable behavior.
- A fixed 120 BPM technical crossfade sequence: four beats of inaudible music pre-roll followed by four beats of overlapping equal-power crossfade.
- Separate percussion trim, music trim, crossfade, and master gain nodes.
- A 100 ms post-gesture start delay for deterministic scheduling headroom.
- Explicit state/error messages.
- Click-free cancellation on reset, `visibilitychange`, and context suspension.
- Unit tests for pure scheduling and envelope behavior.
- Fake-Web-Audio integration tests for node wiring, automation, source ownership, and teardown.
- Production build verification and a structured three-trial real-device worksheet.

### Deferred until Gate 1 passes

- Tap-tempo estimation and silence lock.
- Rolling predicted-percussion scheduling.
- Track BPM/downbeat metadata.
- Measured-BPM to track-BPM quantization.
- Perceptual 10-trial handoff protocol.
- Catalog, matching, provider integration, PWA, backend, accounts, or analytics.

### Hard stop

Do not implement any deferred behavior until the three real-device Gate 1 trials pass on Tony's named acceptance phone/browser. Automated tests cannot substitute for that hardware/browser evidence.

---

## Proposed Repository Layout

```text
bpm-music-match/
├── .github/workflows/ci.yml
├── docs/
│   ├── design/approved-design.md
│   ├── plans/2026-07-24-milestone-1-mobile-audio-gate.md
│   └── validation/mobile-audio-gate.md
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── app-state.ts
│   ├── main.ts
│   ├── styles.css
│   └── audio/
│       ├── audio-engine.ts
│       ├── equal-power.ts
│       ├── gate-plan.ts
│       ├── node-registry.ts
│       └── web-audio-contracts.ts
└── tests/
    ├── app-state.test.ts
    ├── audio-engine.test.ts
    ├── equal-power.test.ts
    ├── gate-plan.test.ts
    ├── node-registry.test.ts
    └── support/fake-audio.ts
```

No placeholder files for Milestone 2 are created.

---

### Task 1: Add the TypeScript/Vite Test Scaffold

**Objective:** Establish a truthful, runnable static application and test toolchain without implementing audio behavior.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/styles.css`
- Modify: `README.md`

**Step 1: Create package metadata and scripts**

Use ESM and these scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

Install only the initial development dependencies:

```bash
npm install -D typescript vite vitest @vitest/coverage-v8
```

**Step 2: Create a minimal app shell**

`index.html` must contain one root element and load `/src/main.ts`. `src/main.ts` may render a truthful placeholder: “Mobile audio gate not implemented yet.” It must not imply the crossfade works.

**Step 3: Verify the scaffold**

Run:

```bash
npm run test:run
npm run build
```

Expected:
- Vitest exits successfully with no test files yet.
- TypeScript and Vite build successfully.
- `dist/` contains the static entrypoint.

**Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src README.md
git commit -m "chore: scaffold mobile audio gate app"
```

---

### Task 2: Implement Equal-Power Curves with TDD

**Objective:** Produce deterministic, shared gain curves for music and percussion.

**Files:**
- Create: `src/audio/equal-power.ts`
- Test: `tests/equal-power.test.ts`

**Step 1: Write failing tests**

Test these behaviors:

```ts
expect(createEqualPowerCurves(5)).toMatchObject({
  music: expect.any(Float32Array),
  percussion: expect.any(Float32Array),
});
```

Assertions:
- Reject fewer than two samples.
- Both arrays have the requested length.
- Music starts at `0` and ends at `1` within floating-point tolerance.
- Percussion starts at `1` and ends at `0`.
- At every sample, `music[i] ** 2 + percussion[i] ** 2` is within `1e-5` of `1`.

**Step 2: Verify RED**

```bash
npm run test:run -- tests/equal-power.test.ts
```

Expected: FAIL because `createEqualPowerCurves` does not exist.

**Step 3: Implement the minimum function**

```ts
export interface EqualPowerCurves {
  music: Float32Array;
  percussion: Float32Array;
}

export function createEqualPowerCurves(sampleCount: number): EqualPowerCurves {
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new RangeError('sampleCount must be an integer >= 2');
  }

  const music = new Float32Array(sampleCount);
  const percussion = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const x = index / (sampleCount - 1);
    music[index] = Math.sin((x * Math.PI) / 2);
    percussion[index] = Math.cos((x * Math.PI) / 2);
  }

  return { music, percussion };
}
```

**Step 4: Verify GREEN**

```bash
npm run test:run -- tests/equal-power.test.ts
npm run test:run
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/audio/equal-power.ts tests/equal-power.test.ts
git commit -m "feat: add equal-power crossfade curves"
```

---

### Task 3: Define the Fixed Gate Schedule with TDD

**Objective:** Represent Milestone 1 timing as a pure, inspectable plan before touching browser audio nodes.

**Files:**
- Create: `src/audio/gate-plan.ts`
- Test: `tests/gate-plan.test.ts`

**Step 1: Write failing tests**

The desired API is:

```ts
const plan = createGatePlan({
  audioNow: 10,
  bpm: 120,
  startDelaySeconds: 0.1,
  leadInBeats: 4,
  crossfadeBeats: 4,
});
```

Assert:
- Beat duration is `0.5` seconds.
- Beat 1 is at `10.1` seconds.
- Percussion beats contain eight timestamps from `10.1` through `13.6`.
- Track starts at beat 1.
- Crossfade starts at beat 5 (`12.1`).
- Crossfade duration is `2.0` seconds.
- Completion is the beat-9 boundary (`14.1`).
- Reject non-finite inputs, BPM ≤ 0, start delay < 0, and non-positive beat counts.

**Step 2: Verify RED**

```bash
npm run test:run -- tests/gate-plan.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the pure plan**

Return a frozen value object containing:

```ts
interface GatePlan {
  bpm: number;
  beatDurationSeconds: number;
  beatTimes: readonly number[];
  trackStartTime: number;
  crossfadeStartTime: number;
  crossfadeDurationSeconds: number;
  completeTime: number;
}
```

Do not read clocks inside `createGatePlan`; callers pass `audioNow`.

**Step 4: Verify GREEN**

```bash
npm run test:run -- tests/gate-plan.test.ts
npm run test:run
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/audio/gate-plan.ts tests/gate-plan.test.ts
git commit -m "feat: define deterministic mobile audio gate schedule"
```

---

### Task 4: Define Injectable Web Audio Contracts and Fakes

**Objective:** Make browser-node wiring testable without pretending Node/Vitest provides real acoustic behavior.

**Files:**
- Create: `src/audio/web-audio-contracts.ts`
- Create: `tests/support/fake-audio.ts`
- Test: `tests/node-registry.test.ts`
- Create: `src/audio/node-registry.ts`

**Step 1: Define the narrow contracts**

Type only the browser members Milestone 1 uses:

```ts
export interface AudioParamLike {
  value: number;
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): void;
}
```

Add narrow interfaces for gain nodes, buffer sources, audio buffers, and the context. The production adapter will use structural compatibility with native nodes; do not wrap every Web Audio API.

**Step 2: Write failing registry tests**

Test that `SourceRegistry`:
- Registers track and percussion sources with generation and intentional-stop metadata.
- Removes each source on `onended`.
- Marks all owned sources as intentionally stopping.
- Does not treat an intentional stop as a natural completion.
- Ignores natural completion from a stale generation.

**Step 3: Verify RED**

```bash
npm run test:run -- tests/node-registry.test.ts
```

Expected: FAIL because the registry is missing.

**Step 4: Implement the registry and fakes**

The fake context records node creation, connections, scheduled automation, source start/stop times, and `onended` callbacks. It must not claim to model acoustic output, autoplay, suspension, or device latency.

**Step 5: Verify GREEN**

```bash
npm run test:run -- tests/node-registry.test.ts
npm run test:run
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/audio/web-audio-contracts.ts src/audio/node-registry.ts tests/support/fake-audio.ts tests/node-registry.test.ts
git commit -m "feat: add testable Web Audio ownership contracts"
```

---

### Task 5: Implement the Raw Web Audio Gate Engine with TDD

**Objective:** Decode one file, build one shared audio graph, schedule the fixed crossfade, and tear it down safely.

**Files:**
- Create: `src/audio/audio-engine.ts`
- Test: `tests/audio-engine.test.ts`

**Step 1: Write failing decode tests**

Desired API:

```ts
const engine = new MobileAudioGateEngine(context, {
  trackTrim: 0.7,
  percussionTrim: 0.35,
  masterGain: 0.8,
});

await engine.decodeTrack(arrayBuffer);
```

Assert:
- Decode stores one buffer and exposes `isReady()`.
- Decode failure rejects with `AudioGateError('decode-failed', ...)`.
- A second decode replaces the first only after successful decoding.

Run and verify RED.

**Step 2: Implement minimal decode behavior**

Keep file bytes and decoded buffers in memory only. No upload, object database, local storage, or analytics.

Run and verify GREEN.

**Step 3: Write failing resume and run tests**

Assert that `runGate()`:
- Rejects when no track is decoded.
- Calls `context.resume()` before scheduling.
- Creates all nodes from one context.
- Wires `percussion source → percussion trim → percussion crossfade → master`.
- Wires `track source → track trim → track crossfade → master`.
- Schedules eight one-shot percussion sources at the gate-plan beat times.
- Starts the track at beat 1 with offset `0` for the technical gate.
- Keeps track crossfade gain at zero until beat 5.
- Applies both equal-power curves at the same beat-5 time and duration.
- Uses fixed trims `0.70`, `0.35`, and master `0.80`.
- Emits a completion event only for the active generation.

Run and verify RED.

**Step 4: Implement minimal scheduling**

Use a generated short percussion `AudioBuffer`; do not add Tone.js. Use `createBufferSource()` for every percussion hit and the track.

Run focused and full tests to verify GREEN.

**Step 5: Write failing teardown tests**

Cover cancellation:
- Before scheduled track start.
- During the inaudible pre-roll.
- During crossfade.
- After crossfade while playing.
- Twice in succession.
- Followed by an old source's `onended`.

Assert the engine:
- Invalidates the generation.
- Marks sources intentionally stopping.
- Cancels scheduled gain automation.
- Holds or sets the current known envelope value.
- Applies a 20 ms ramp to zero.
- Schedules `stop()` at 25 ms.
- Cleans nodes in `onended`, not synchronously.
- Never emits natural-completion for an intentional or stale source.

Run and verify RED.

**Step 6: Implement idempotent teardown**

Keep one teardown path for reset, visibility change, context suspension, and replacing a run.

Run focused and full tests to verify GREEN.

**Step 7: Commit**

```bash
git add src/audio/audio-engine.ts tests/audio-engine.test.ts
git commit -m "feat: implement cancellable raw Web Audio gate engine"
```

---

### Task 6: Implement the UI Reducer with TDD

**Objective:** Make application states and recovery actions explicit before rendering controls.

**Files:**
- Create: `src/app-state.ts`
- Test: `tests/app-state.test.ts`

**Step 1: Write failing reducer tests**

States:

```ts
type AppState =
  | { kind: 'selecting' }
  | { kind: 'decoding'; fileName: string }
  | { kind: 'ready'; fileName: string }
  | { kind: 'running'; fileName: string }
  | { kind: 'completed'; fileName: string }
  | { kind: 'error'; fileName?: string; code: string; message: string };
```

Test legal transitions and reject/ignore stale generation events. Required events: file selected, decode succeeded/failed, run requested, run completed/failed, reset, document hidden, context suspended.

**Step 2: Verify RED**

```bash
npm run test:run -- tests/app-state.test.ts
```

Expected: FAIL because the reducer is missing.

**Step 3: Implement the reducer**

No DOM or Web Audio calls belong in the reducer.

**Step 4: Verify GREEN**

```bash
npm run test:run -- tests/app-state.test.ts
npm run test:run
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/app-state.ts tests/app-state.test.ts
git commit -m "feat: define mobile audio gate state transitions"
```

---

### Task 7: Wire the Mobile UI to the Engine

**Objective:** Expose one clear, thumb-friendly Gate 1 flow without implementing the later tap-tempo product.

**Files:**
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Modify: `index.html`

**Step 1: Add an executable DOM smoke test before behavior**

Create a testable `renderApp(root, dependencies)` entrypoint and a minimal DOM test only if Vitest's environment can exercise it without adding a large browser framework. Otherwise keep reducer and engine behavior covered automatically and make the rendered UI part of the real-browser gate; document that boundary instead of faking browser support.

**Step 2: Render the exact flow**

- **Selecting:** file picker and privacy copy: “Your file stays on this device and is not uploaded.”
- **Decoding:** disabled controls and progress label.
- **Ready:** one large **Run audio gate** button and explanation that this is a fixed 120 BPM technical test, not song matching.
- **Running:** **Stop** button and visible stage label.
- **Completed:** result prompt plus **Run again** and **Choose another file**.
- **Error:** plain failure reason plus one recovery action.

The first direct press of **Run audio gate** calls `AudioContext.resume()` and schedules the sequence in the same event-handler call stack.

**Step 3: Wire lifecycle interruption**

On `document.visibilitychange` to hidden and `AudioContext.statechange` to suspended/interrupted, invoke the same teardown path and return to ready.

**Step 4: Verify**

```bash
npm run test:run
npm run build
```

Expected: all tests and the production build pass.

Open the development server in a real browser and verify the file picker, truthful state labels, run, stop, and reset controls. This is a smoke check, not the mobile acceptance gate.

**Step 5: Commit**

```bash
git add index.html src/main.ts src/styles.css
git commit -m "feat: add mobile audio gate interface"
```

---

### Task 8: Add CI and Static Deployment Configuration

**Objective:** Make every push reproducibly test and build the static app; prepare GitHub Pages without assuming a remote exists.

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `vite.config.ts`
- Modify: `README.md`

**Step 1: Add CI**

The workflow must:
- Use the checked-in Node package lock.
- Run `npm ci`.
- Run `npm run test:run`.
- Run `npm run build`.
- Upload no user-selected audio.

**Step 2: Configure a relative/static-safe Vite base**

Use a base that works for local preview and a future GitHub Pages repository path. Do not enable deployment until the repository has a verified remote and Pages target.

**Step 3: Verify locally**

```bash
npm ci
npm run test:run
npm run build
npm run dev -- --host 127.0.0.1
```

Perform an HTTP request to the running server and verify status 200. Stop the server cleanly.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml vite.config.ts README.md
git commit -m "ci: verify mobile audio gate build"
```

---

### Task 9: Create the Real-Device Gate Worksheet

**Objective:** Define the exact evidence needed before Milestone 2 can begin.

**Files:**
- Create: `docs/validation/mobile-audio-gate.md`
- Modify: `README.md`

**Step 1: Write the worksheet**

Include fields for:

```text
build commit
served HTTPS URL
phone / OS / browser version
track label (no local filesystem path)
trial number 1–3
fresh page load: yes/no
decode success: yes/no
resume from first Run press: yes/no
second gesture required: yes/no
percussion audible: yes/no
music audible: yes/no
crossfade completed: yes/no
audible clipping: yes/no
background cancellation returned to ready: yes/no
failure reason
notes
```

**Step 2: State the pass rule**

All three trials must pass every required field. Any failure leaves Milestone 2 blocked. A generated desktop test, fake node test, or local non-HTTPS run is not substitute evidence.

**Step 3: Verify documentation links**

Confirm README links to the approved design, implementation plan, and validation worksheet, and describes Milestone 1 as implemented only after the build exists.

**Step 4: Commit**

```bash
git add docs/validation/mobile-audio-gate.md README.md
git commit -m "docs: add mobile audio acceptance gate"
```

---

### Task 10: Final Automated Verification and Handoff

**Objective:** Prove the repository is internally complete for Milestone 1 and state the remaining hardware/browser gate honestly.

**Files:**
- Modify only if verification exposes a real issue; any fix starts with a failing test.

**Step 1: Run the complete automated gate**

```bash
npm ci
npm run test:run
npm run test:coverage
npm run build
git status --short
git log --oneline --decorate -10
```

Expected:
- All tests pass.
- Coverage runs without warnings or hidden failures.
- Production build succeeds.
- Working tree is clean.
- History contains focused task commits.

**Step 2: Exercise the built artifact**

Serve `dist/` with a local static server, request the root document, and verify referenced built assets return HTTP 200. This proves build entrypoints resolve; it does not prove mobile audio behavior.

**Step 3: Report exact completion state**

Report:
- Automated test/build outputs.
- Commit range.
- Files added.
- Whether a remote/deployed HTTPS URL exists.
- `MILESTONE 2 BLOCKED` until Tony completes the three real-device trials.

Do not claim the crossfade works on Tony's phone before those trials occur.

---

## Autoplan Review Questions

The review pipeline should challenge, but not silently broaden, these points:

1. Is raw Web Audio plus dependency injection the smallest maintainable Gate 1 boundary?
2. Does accepting one local file avoid licensing and privacy risk without becoming a general library feature?
3. Is the fixed 120 BPM gate sufficient to prove delayed scheduled playback and independent gain automation?
4. Are fake-node tests honest about what they cannot prove?
5. Does the lifecycle teardown contract cover the direct blast radius without implementing Milestone 2 early?
6. Is GitHub Pages configuration premature before a remote exists, and should deployment remain disabled until one is verified?
7. Are any proposed abstractions empty placeholders for deferred work?

## Implementation Approval Boundary

The approved office-hours design already confirms the product premises and the controlled-audio direction. `/autoplan` may refine implementation mechanics. It must surface any recommendation that changes these user-approved boundaries instead of auto-deciding it:

- true overlapping crossfade is the product;
- both audio streams remain inside one app-owned raw Web Audio graph;
- YouTube/provider integration is deferred;
- Milestone 1 precedes tap-tempo and matching behavior;
- real-device evidence is mandatory before Milestone 2.
