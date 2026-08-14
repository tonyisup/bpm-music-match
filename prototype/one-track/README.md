# One-track vertical slice

This directory is an **independent product boundary** for the Milestone 2 one-track experiment. It does not import the Gate 1 spike, enrollment utility, protected design material, or private fixtures. Pure runtime modules live under `src/`; product tests live under `tests/`.

## Local start

Run the complete product contracts from the repository root:

```sh
/usr/local/bin/python3.13 scripts/verify_gate.py
```

The source build placeholders intentionally fail closed. Stage the reviewed 20-file browser surface with the current commit identity, then serve it without adding a server dependency:

```sh
SITE_PARENT=$(mktemp -d)
/usr/local/bin/python3.13 scripts/stage_one_track_local.py "$(git rev-parse HEAD)" "$SITE_PARENT/site"
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$SITE_PARENT/site"
```

Open exactly one of the fixed run URLs:

- `http://localhost:8000/?run=session-1`
- `http://localhost:8000/?run=session-2`
- `http://localhost:8000/?run=session-3`
- `http://localhost:8000/?run=session-4`
- `http://localhost:8000/?run=session-5`
- `http://localhost:8000/?run=smoke-crossfade`
- `http://localhost:8000/?run=smoke-playing`

Missing, repeated, malformed, or unknown `run` values fail closed before local file selection.

## Privacy boundary

**No private file may enter this repository, staging, a request, persistence, diagnostics, or evidence.** Never add the selected filename, path, URI, bytes, decoded samples, artwork, audio content, or any private-file-derived string. The reviewed sanitized metadata in `src/track-metadata.mjs` is the only asset information permitted in this product. Local selection must remain transient and browser-local in later tasks.

## Build and staging architecture

Runtime configuration, sanitized track metadata, protocol run context, and build identity are static product-local modules. They use no runtime URL or configuration fetch. Every executable module carries one embedded deploying commit and checks it against `src/build-identity.mjs` before selection or audio setup; placeholder, malformed, or mixed identities fail closed.

The deployment pipeline performs **source-to-root staging**: the reviewed contents of `prototype/one-track/` become the staged site root, so product `src/` becomes staged `/src/` and the later product `index.html` becomes staged `/index.html`. The source directory name is never a public URL prefix. Staging replaces each build placeholder once with the same full 40-character deploying commit.

## Human gates

Automated checks may verify and stage a candidate, but publication remains a **human merge gate**. No pull-request workflow may deploy. After merge and immutable identity confirmation, real-device acceptance remains a separate **human Pixel gate**. Neither gate authorizes committing, uploading, transmitting, or redistributing the private track.
