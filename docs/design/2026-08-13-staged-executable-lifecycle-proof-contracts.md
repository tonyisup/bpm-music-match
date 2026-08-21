# Staged Executable Lifecycle-Proof Contracts

Date: 2026-08-13

Status: **APPROVED ARCHITECTURAL DIRECTION**

Decision owner: Tony

Repository: `tonyisup/bpm-music-match`

Branch at decision: `feat/m2-one-track-vertical-slice`

HEAD at decision: `c7636c17f595bea7a61cb5f20a87d18933cc6df2`

## Decision

Adopt **staged executable contracts** for the Stage 2/H4 lifecycle-proof boundary.

Do not attempt another all-at-once V4 specification. Build and independently approve one small executable contract at a time. Each approved stage exposes tested interfaces and exact artifacts that the next stage may cite. Later stages must be designed from those real interfaces rather than from speculative file names or implied schemas.

This decision changes the proof-program development process. It does **not** change Milestone 2 product semantics, authorize lifecycle production changes, or rehabilitate any rejected proof artifact.

### 2026-08-13 dependency-backed Python-foundation supersession

The first two JavaScript F0A canonical-byte plans were rejected. V1 made false post-module intrinsic-hardening and typed-array provenance claims. V2 narrowed those claims but still left canonical byte length vulnerable to shadowed typed-array properties and treated an ignored characterization file as mutable TDD authority. The bounded two-cycle stop was reached before production code existed.

Tony first chose to move the proof foundation to Python. Python `3.13.7` already owns repository verification and the later proof stages are artifact/filesystem-oriented. Node remains the product and extraction runtime; it does not own proof-artifact canonicalization or promotion authority.

Two exact-byte standard-library Python PF0A plans were then rejected before production. V1 left authority, rejected-input allocation, multibyte limits, and workspace/commit gates incomplete. V2 corrected those defects, but its source blacklist could not prove an emission-only/no-hidden-callback module and its failure-propagation tests omitted Unicode normalization.

Tony therefore chose a maintained canonicalization dependency behind a narrow local adapter. The selected candidate is Trail of Bits `rfc8785==0.1.4`, pinned to the PyPI wheel SHA-256 `520d690b448ecf0703691c76e1a34a24ddcd4fc5bc41d589cb7c58ec651bcd48`. The package owns RFC 8785/JCS string escaping, UTF-16 object-key ordering, numeric representation, and byte emission. The local adapter owns the narrower exact-built-in domain, NFC/noncharacter policy, cycle/resource checks, immutable snapshot construction, final LF, fixed public domain error, and propagation of dependency/interpreter faults.

This is a fresh microstage class, not PF0A V3 and not permission to port the rejected local encoder. Parsing remains excluded unless the next independently reviewed contract needs it.

## Why this decision is necessary

Three exact-byte replacement specifications were rejected:

- V1 failed on real Node reporter semantics, nested selection, discovery completeness, and approval provenance.
- V2 closed several V1 gaps but retained contradictory subprocess ownership, ambiguous identities, and duplicated observation authority.
- V3 closed the architecture/security findings and received an architecture/security approval, but still tried to predeclare every Gate B/C/D/E module, schema, report, renderer, and promotion edge. Two reviewers rejected it because named outputs lacked executable schemas/owners and Gate C rendering contradicted the Gate E verified-renderer boundary.

The remaining failure was structural: the specification attempted to define future executable interfaces before those interfaces existed. Adding more prose would repeat that failure mode.

## Governing rules

1. **One executable contract per stage.** A stage defines only its own files, commands, schemas, artifacts, tests, and nonclaims.
2. **Tests precede production code.** Every behavioral contract follows RED → GREEN → refactor. Existing behavior that is already green is documented rather than represented as a manufactured RED.
3. **No future artifact names without owners.** A stage may mention a later capability, but it may not prescribe a later output, schema, renderer, or promotion field.
4. **Every persisted JSON artifact has one schema and one production owner.** Human-facing output is separately owned and cannot masquerade as verified evidence.
5. **Every command has an exact output set.** Volatile diagnostics remain bounded stderr and are not approval bytes.
6. **Candidate manifests never hash themselves.** They bind an explicit, ordered artifact set. A sibling review manifest or external coordinator identifies the completed candidate manifest by digest.
7. **Review verdicts and promotion locks are external inputs.** Candidate-producing commands cannot mint approval. Validation is executable; human identity remains an external coordinator/user responsibility.
8. **Any byte change invalidates approval.** A correction produces a new candidate manifest and a fresh same-byte review set.
9. **Rejection precedence is absolute.** One current-digest rejection invalidates the candidate. Timeout or missing verdict is not approval.
10. **No product authority leaks forward.** Proof tooling describes pinned current source. It cannot decide deferred lifecycle policy, authorize Task 9, open a browser/device, access private fixtures, or claim browser/native release.

## Stage sequence

### Stages PF0A–PF0G — Python contract foundation

The rejected combined F0, Node F0A, and standard-library Python PF0A plans showed that canonical emission, canonical loading, filesystem identity, manifests, verdicts, promotion joins, and CLI behavior are not one executable contract. Build them as independently approved Python microstages:

- **PF0A:** a hash-pinned RFC 8785 dependency plus a narrow approved-value adapter to canonical JCS bytes with one final LF;
- **PF0B:** canonical JSON byte loading/validation to approved Python values, designed only after PF0A approval and only if required by the first persisted consumer;
- **PF0C:** repository artifact descriptors, designed only after PF0B approval;
- **PF0D:** candidate-manifest construction and validation, designed only after PF0C approval;
- **PF0E:** review-verdict construction and validation, designed only after PF0D approval;
- **PF0F:** promotion-lock construction and validation, designed only after PF0E approval;
- **PF0G:** validation CLI and repository-gate integration, designed only after PF0F approval.

PF0A has one dependency lock, one narrow Python adapter, and no parser, filesystem, Git, descriptor, manifest, verdict, lock, CLI, product-source, browser/device, private-fixture, or runtime-network behavior. Dependency installation may use one exact temporary external virtual environment during implementation/verification, and syntax verification may create one separately named exact external bytecode-cache tree. Both paths must be absent before first use, must be non-symlink directories after creation, and must be removed and verified absent after the approved local implementation commit; the bytecode tree is non-authoritative generated state and is never reviewed as implementation evidence. PF0A itself performs no network or filesystem access. It emits immutable `bytes` from a closed exact-builtin domain through the pinned public `rfc8785.dump` API and a bounded local sink. Each later microstage consumes its approved predecessor instead of redefining it. No later PF0 schema, command, or field set is authoritative until that microstage is separately planned, executed, and approved.

Stages PF0A–PF0G do not parse product JavaScript, extract lifecycle facts, curate semantics, instrument tests, render lifecycle reports, or validate any Gate B/C/D/E artifact from rejected V3.

### Stage F1 — Raw syntax extraction

Designed only after PF0G is implemented, approved, and committed. It may use the actual approved PF0A–PF0G interfaces. It owns the JavaScript parser dependency, exact lifecycle source scope, raw syntax schema, discovery accounting, and extraction mutations.

### Stage F2 — Curated current-source inventory

Designed only after F1 approval. It owns semantic inventory validation and an explicitly unverified human review view. It does not reuse a verified-only renderer.

### Stage F3 — Producer execution evidence

Designed only after F2 approval. It owns temporary-copy instrumentation, selected-inner-test liveness, macOS process groups/sandboxing, unique observation counts, and the sole stable execution-evidence artifact.

### Stage F4 — Combined verification and verified rendering

Designed only after F3 approval. It recomputes prior stages through their approved executable interfaces, validates the monotonic approval chain, and alone may produce a verified human-readable lifecycle view.

## Stage transition gate

A stage advances only when all are true:

- focused tests and cumulative repository gates pass;
- exact candidate membership and byte bindings are recomputed through the latest approved boundary; an external review sidecar remains authoritative until a separately approved candidate-manifest boundary can bind a candidate without self-reference;
- three independent reviewers approve the same exact candidate identity produced by that latest approved boundary;
- no reviewer rejects and no required verdict is missing or timed out;
- tracked/staged workspace identity is pinned;
- Tony authorizes the next stage after seeing the implemented interface and its limitations.

Approval of one PF0 microstage authorizes designing only its immediate successor. Approval of PF0G authorizes designing F1—not implementing F2–F4 and not changing product lifecycle behavior.

## Preserved evidence

The following remain immutable, non-authorizing design/rejection evidence under `.hermes/plans/`:

- lifecycle proof-boundary spike and reassessment;
- lifecycle proof-boundary specifications V1, V2, and V3;
- each exact review manifest;
- each rejection reassessment, including the V3 architectural stop.

Useful V3 architecture/security conclusions may inform a later stage only when restated in that stage's executable contract and proven by tests. A prior approval cannot transfer across bytes or stages.

## Explicit nonclaims

This decision does not:

- assert that the current lifecycle inventory has 29 correct semantic rows;
- choose pagehide, suspend-failure, listener/acceptance, Reset/Unload, or C0–C3 policy;
- authorize Gate B as described by rejected V3;
- authorize production or permanent product-test edits;
- authorize deployment, browser, Android, audio-device, or private-fixture work;
- authenticate a malicious local operator or reviewer identity cryptographically;
- make `.hermes/plans` product authority.

## Current authorized planning action

Write and review the dependency-backed PF0A adapter implementation plan. Bind the exact package artifact and restate all normative characterization in the tracked, protected plan. PF0A dependency lock and production code begin only after that exact plan is accepted. This document records the governing direction; it is not itself implementation approval for any microstage.
