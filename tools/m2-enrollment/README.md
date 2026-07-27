# Private Milestone 2 track enrollment

This runbook enrolls the one private candidate track for the Milestone 2 experiment. It is a bootstrap exception, not a product file-selection flow. The exception exists because the private MP3 cannot enter the repository or a public deployment, while the experiment still needs a reviewed, closed-schema identity for those exact local bytes.

The public utility is served from <https://tonyisup.github.io/bpm-music-match/enroll/> and necessarily loads its static HTML, CSS, and modules from that origin. After those resources load, the selected file and file-derived data have no request, upload, remote-logging, persistence, service-worker, media-element, or object-URL path. Its only successful output is a local sanitized JSON report.

> **Never upload or send the MP3.** Keep it local on the accepted Pixel. Do not commit it, attach it to an issue or message, place it in Pages staging, or copy its filename, path, URI, bytes, or audio content into a report.

## What this exception proves

A completed run proves all of the following narrow claims:

- the same local MP3 produced the same SHA-256 in two cycles;
- Chrome reported the configured `audio/mpeg` MIME type and the file stayed within fixed compressed and decoded limits;
- the manually chosen downbeat passed a bounded 50 ms cue-energy check;
- the configured 110 BPM was explicitly confirmed as the track's 1:1 pulse;
- two matching clean cycles completed with all application-owned counters at zero and both context-close operations settled;
- the utility produced the closed `assetIdentity` and `experimentConfigIdentity` report.

It does not prove browser/native memory release. JavaScript cannot reliably observe Chrome decoder, native heap, or process-memory release. The report therefore records `browserHeapObserved: false` while making only the narrower application-owned cleanup claim.

## Before using the Pixel

Use the accepted device and browser:

- Pixel 8 Pro
- Android 16 build `CP1A.260505.005`
- Chrome `150.0.7871.181`

From the exact reviewed `main` checkout, verify the code candidate and record its expected deployment identity:

```bash
EXPECTED_DEPLOY_SHA=$(git rev-parse HEAD)
python3 scripts/verify_gate.py
git diff HEAD --check
git diff --check
RUN_ID=$(gh run list --workflow deploy-pages.yml --branch main --commit "$EXPECTED_DEPLOY_SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
printf '%s\n' "$EXPECTED_DEPLOY_SHA"
```

The unified verifier must pass all ten stages, `git diff HEAD --check` must check the staged and unstaged candidate, and the Pages workflow for `EXPECTED_DEPLOY_SHA` must succeed. Keep that expected full SHA available for the Pixel comparison below. Keep the candidate MP3 only in local device storage accessible to Android's file picker. The configured candidate is expected to be an `.mp3`, no larger than 20 MiB, with a manually verified 1:1 tempo of 110 BPM.

## Exact `/enroll/` Pixel sequence

If the page enters a reload-only state, the SHA differs, MIME is unexpected, cue analysis fails repeatedly, or cleanup is not proven, stop. Reload and restart from cycle one rather than working around the status.

1. Open the deployed `/enroll/` utility

   Before selecting any file, replace the placeholder in `https://tonyisup.github.io/bpm-music-match/enroll/enrollment-build.mjs?v=<EXPECTED_DEPLOY_SHA>` with the expected full SHA printed above and open that cache-busted module URL in Pixel Chrome. Confirm the source line `ENROLLMENT_BUILD_COMMIT` exactly equals the expected full SHA. A coherent but stale deployment can pass its internal mixed-cache checks, so stop if this external comparison differs. Then open <https://tonyisup.github.io/bpm-music-match/enroll/> as a top-level page and reload once before selecting the private file. Do not embed it or switch away during a load, preview, unload, copy, or download operation.

2. Select the candidate MP3

   Use **Reference track MP3** to select the private candidate from local device storage. The picker clears immediately after the page captures the `File`. Wait for **Track ready. Preview and analyze the target downbeat.** Do not infer or rename around an extension or MIME rejection.

3. Preview and confirm the target downbeat

   Enter the best approximate downbeat time, then tap **Play preview**. While the raw Web Audio preview reaches the clean target downbeat, tap **Use preview time** to copy the current position. Tap **Stop preview**, then **Analyze cue**. Repeat this bounded adjustment until the cue passes and it sounds like the intended clean 4/4 entry downbeat. The energy check cannot replace your ear.

4. Confirm the configured 110 BPM

   Use the raw preview at normal speed and an external stopwatch so Chrome remains foregrounded. Count the first clearly heard quarter-note pulse as onset 1, start timing on that onset, and stop on the 45th onset. This measures 44 beat intervals. At 110 BPM the elapsed time is 24.0 seconds. Repeat the measurement three times from stable musical passages. Accept only if all three measurements are within 24.0 ±0.25 seconds and the counted pulse is the intended quarter-note movement pulse rather than a half-time or double-time layer. Record the three elapsed values locally for the operator check; they are not shareable enrollment artifacts. Then select **I confirm the configured 110 BPM**. The utility does not estimate tempo. The locked report's `trackBpm: 110` value is the reviewable record that this explicit gate passed; the checkbox alone is not evidence.

5. Unload the first cycle

   Tap **Unload** and wait for **First clean cycle completed. Select the same local MP3 again.** This status requires settled context close and zero application-owned raw-buffer, decoded-buffer, context, preview-source, and source-registry counters.

6. Select the same local MP3 again

   Select the same local MP3 from step 2. Wait for the ready status. A different SHA resets enrollment instead of merging two identities. If that happens, stop and restart deliberately with one file.

7. Repeat preview and cue analysis

   Repeat **Play preview**, **Use preview time**, **Stop preview**, and **Analyze cue** for cycle two. Confirm by ear that the accepted cue is still the intended target entry downbeat. Confirm the 110 BPM checkbox remains selected; select it again if needed.

8. Unload the second cycle

   Tap **Unload** and wait for **Two matching clean cycles completed. Sanitized report ready.** If the page instead asks for BPM confirmation, confirm only after independently rechecking the 1:1 interpretation. Do not continue if cleanup is reload-only or the report remains locked.

9. Download `m2-enrollment-report.json`

   Tap **Download report**. Prefer the downloaded file over copying from the screen. The exact downloaded `m2-enrollment-report.json` is the only enrollment artifact that may leave the Pixel.

## What may be shared

Share only the complete, unedited `m2-enrollment-report.json` produced after the two matching clean cycles. Its closed top-level schema contains exactly:

- `assetIdentity`: approved public labels plus extension/MIME policy, SHA-256, bounded size/decode facts, and narrow application cleanup evidence;
- `experimentConfigIdentity`: the explicitly confirmed BPM/downbeat and the versioned musical and policy configuration.

The report contains no local filename, path, URI, raw bytes, audio samples, object URL, browser log, or browser/native memory-release claim. Do not supplement it with the MP3, screenshots of the picker, console output containing local context, or a hand-written metadata object.

## Stop and authorization boundary

Fixture completion means the accepted Pixel produced the closed report through the exact nine-step sequence and that report passed review. Until then, the enrollment utility does not authorize Milestone 2 product implementation.

Even after fixture completion, this bootstrap authorizes only use of the reviewed sanitized identity in the separately approved one-track vertical slice. It does not authorize a generalized file picker, upload path, catalog, provider integration, persistence layer, automatic BPM/downbeat detection, or any claim of browser/native memory release.
