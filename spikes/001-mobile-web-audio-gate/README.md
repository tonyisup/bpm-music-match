# Milestone 1: mobile Web Audio gate

This directory is one disposable Android Chrome feasibility experiment. It owns the browser runtime, canonical asset, immutable asset metadata, the single mutable calibration record, tests, and acceptance worksheet.

## Locked boundary

- one `AudioContext` created during loading;
- one decoded original 120 BPM WAV;
- one synthesized percussion click buffer created by that context;
- one raw Web Audio graph with no media element;
- one Run activation and one Stop control;
- one fresh-load generation; every terminal state requires reload;
- Android Chrome is the sole acceptance environment.

The UI deliberately withholds schedule and phase fields during Starting, Running, and Stopping. This prevents visible timing from biasing the listening judgment.

## Audio graph

```text
8 tracked click BufferSourceNodes -> percussion fade -> percussion trim --+
                                                                      +-> master -> destination
1 tracked WAV BufferSourceNode ----> track fade ------> track trim ----+
```

The track starts at the same scheduled audio time as percussion beat 1 with offset zero. The equal-power overlap starts at beat 5 and ends at the beat-9 boundary. Both 128-sample gain curves are created once per run. The track continues after the overlap so the handoff can be judged without an immediate ending cue.

Every source is registered before connect/start. A scheduling exception rolls back all partial ownership. The first terminal cause wins; stale callbacks are no-ops.

## Lifecycle and teardown

- Run calls `context.resume()` and retains its promise.
- Before the first await, Run synchronously creates and schedules the complete active generation.
- A five-second watchdog maps unresolved startup to `startup-timeout`.
- Manual Stop while Running ramps both fade gains for 20 ms and schedules source stop at 25 ms.
- Manual cleanup settles on all `onended` callbacks or a 100 ms wall-clock deadline.
- Hidden, suspended, interrupted, and non-running teardown clear source ownership immediately.
- Terminal diagnostics freeze only after `activeSourceCount` is zero, `teardownSettled` is true, and the context is closed.

## Calibration ownership

`calibration.json` is the only source of truth for gain trims. This README intentionally does not duplicate its numeric values.

Calibration procedure:

1. Verify and deploy the current commit.
2. Confirm the Ready identity snapshot on Android Chrome.
3. Run one fresh-load local/deployed listening pass.
4. If adjustment is necessary, change only `calibration.json`.
5. Rerun `python3 scripts/verify_gate.py`, commit, push, wait for that commit's Pages deployment, reconfirm identity, and run one smoke.
6. Freeze deployment before the three acceptance trials.

Do not change synthesis, schedule, curves, UI, or asset during calibration.

## Local and deployed execution

Use the root [Quick Start](../../README.md#quick-start). Local serving must remain loopback-only. Real acceptance uses the public HTTPS Pages URL, never a LAN HTTP origin.

Complete [validation/gate-1.md](validation/gate-1.md) for the exact Android device and Chrome build. A technical PASS is necessary but does not establish workout usefulness or the product's handoff magic.
