# Lifecycle-Proof PF0A RFC 8785 Adapter Implementation Plan

> **For Hermes:** Implement only after three mandatory reviewers approve these exact design and plan bytes. Execute each behavioral case sequentially under the causal TDD and workspace gates below.

**Goal:** Convert a closed, bounded in-memory Python value domain into deterministic RFC 8785/JCS bytes plus one LF through a hash-pinned maintained dependency and a narrow local adapter.

**Architecture:** Trail of Bits `rfc8785==0.1.4` exclusively owns JSON string escaping, UTF-16 object-key ordering, number representation, punctuation, and UTF-8 emission. The local adapter validates and privately snapshots a narrower exact-built-in domain, enforces Unicode/cycle/resource policy, sends only that snapshot to the dependency's public `dump` API through a bounded private sink, appends one LF, and converts only its own private domain signal to one fixed public `TypeError`.

**Tech Stack:** CPython `3.13.7`, `unittest`, `unicodedata`, `rfc8785==0.1.4`, an external temporary virtual environment, and a hash-locked binary-wheel installation. No runtime dependencies beyond `rfc8785`; no vendoring.

**Normative authority:**

- `docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md`;
- this tracked plan, including the dependency characterization and exact wire/resource contracts below.

Ignored `.hermes/plans/` artifacts are historical review provenance only. No PF0A behavior or task gate depends on their continued presence or bytes.

This is a fresh dependency-backed microstage after the standard-library Python PF0A V1/V2 stop. It is not PF0A V3, and no approval from Node or standard-library candidates transfers. It authorizes no production file until these exact documentation bytes receive three same-byte approvals. It authorizes no push, PF0B–PF0G work, F1–F4 work, product change, browser/device action, private-fixture access, deployment, or repository-gate integration.

---

## Exact package and supply-chain boundary

PF0A selects exactly:

- package: `rfc8785`;
- version: `0.1.4`;
- publisher: Trail of Bits;
- license: Apache-2.0;
- PyPI wheel: `rfc8785-0.1.4-py3-none-any.whl`;
- wheel SHA-256: `520d690b448ecf0703691c76e1a34a24ddcd4fc5bc41d589cb7c58ec651bcd48`;
- wheel size: `9_240` bytes;
- installed public module SHA-256: `fa44927afd547caf7547247078bcf28863d1e69caf116d258c532b3f20ffd154` for `rfc8785/__init__.py` (`496` bytes);
- installed implementation module SHA-256: `c25bc3a046528482d53bee3487b837f31dd9c05f33e8f13288c7aab320932cec` for `rfc8785/_impl.py` (`7_251` bytes);
- source distribution SHA-256, provenance only and not installed: `e545841329fe0eee4f6a3b44e7034343100c12b4ec566dc06ca9735681deb4da`;
- upstream release tag: `v0.1.4`, commit `4d9b161f6054301d98d0566e813d020fb019ee10`, reported by GitHub as a valid signed commit;
- Python requirement: `>=3.8`;
- runtime dependencies: none.

The repository lock file contains exactly one requirement line and one terminal LF:

```text
rfc8785==0.1.4 --hash=sha256:520d690b448ecf0703691c76e1a34a24ddcd4fc5bc41d589cb7c58ec651bcd48
```

Installation uses `pip --only-binary=:all: --no-deps --require-hashes` into an external temporary virtual environment. The implementation imports only the public package root and calls only public `rfc8785.dump`; it never imports `rfc8785._impl` or copies upstream source. The lock does not automatically authorize future package releases. Any version or wheel-hash change is a new microstage candidate requiring characterization and same-byte review.

Dependency installation is a setup/network action outside PF0A runtime. The adapter itself performs no network, package installation, or dynamic dependency resolution. CI/deployment workflow integration remains PF0G and is not changed here.

## Characterization on pinned Python

The exact wheel hash above was verified before local installation and exercised under CPython `3.13.7`. The following facts are normative because they are restated here:

- `rfc8785.__version__` and `importlib.metadata.version('rfc8785')` are `0.1.4`;
- `rfc8785.dumps` returns exact built-in `bytes` and `rfc8785.dump(value, sink)` writes bytes to a caller-owned sink;
- U+10000 sorts before U+E000, including after a shared prefix, because RFC 8785 orders object properties by UTF-16 code units;
- controls use short escapes where defined, other U+0000–U+001F controls use lowercase `\u00xx`, slash is literal, and U+2028/U+2029 are literal UTF-8;
- the dependency preserves Unicode normalization form; it accepts both NFC `é` and NFD `e\u0301`, so the adapter must enforce NFC;
- the dependency accepts floats, tuples, and exact-type subclasses, so the adapter must close its own domain and pass only a private exact-built-in snapshot;
- it accepts integers through the symmetric safe-integer range, but this adapter narrows to nonnegative safe integers;
- it rejects lone surrogates, but the adapter additionally rejects Unicode noncharacters;
- it emits no trailing LF; the adapter owns exactly one final LF.

Upstream maintenance activity and CI are selection evidence, not runtime authority. The exact package artifact, public API behavior, local adapter contract, and tests are the authority.

## Exact files

Documentation baseline:

```text
docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md
docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md
```

PF0A implementation candidate may add exactly:

```text
requirements/lifecycle-proof.txt
scripts/lifecycle_proof_canonical_json.py
scripts/test_lifecycle_proof_canonical_json.py
```

No workflow, README, repository verifier, product source/test, package manifest, parser, CLI, descriptor, manifest, verdict, promotion lock, browser/device, fixture, or deployment file changes in PF0A.

## Production interface

`scripts/lifecycle_proof_canonical_json.py` exports exactly:

```python
def encode_canonical_json(value: object) -> bytes:
    """Return bounded RFC 8785 bytes plus LF or raise the closed TypeError."""
```

All implementation names other than `encode_canonical_json` begin with `_`. Imports are exactly `import rfc8785 as _rfc8785` and `import unicodedata as _unicodedata`. The module has no parser, decoder, callback parameter, dependency injection, file/sink parameter, CLI, hash helper, or alternate encoder.

Every successful call returns a fresh exact built-in `bytes`. Every local domain, Unicode, cycle, or resource rejection raises a fresh exact built-in `TypeError` with exact message:

```text
invalid canonical JSON value
```

Only one private local domain exception is converted. `rfc8785.CanonicalizationError`, `MemoryError`, `RuntimeError`, `KeyboardInterrupt`, `SystemExit`, normalization faults, sink defects, and every other unexpected dependency/interpreter failure propagate unchanged. The public function must not catch `Exception` or `BaseException`.

## Threat, privacy, and ownership boundary

PF0A accepts cooperative in-process Python data and assumes no concurrent mutation during a call. Exact built-in type checks prevent caller-defined iteration, mapping, descriptor, serialization, or numeric hooks. Before invoking the dependency, the adapter recursively constructs a private graph containing only fresh exact built-in lists/dicts and accepted immutable exact built-in scalar references. Caller containers are never passed upstream. Shared acyclic input containers may be copied separately at each occurrence; active-path cycles reject.

The private snapshot is not exposed and is not mutated after construction. `rfc8785.dump` receives only that snapshot and a private bounded sink. No input, snapshot, partial output, or error detail is logged or persisted.

PF0A does not claim safety against interpreter compromise, monkey-patched imported modules, hostile threads/signals, native/heap release timing, malicious package-index infrastructure outside the pinned hash check, or cryptographic reviewer/operator identity.

## Closed local value domain

Accept only:

- `None`;
- exact `bool`;
- exact `int` in inclusive range `0..9_007_199_254_740_991`;
- exact accepted `str`;
- exact `list` of accepted values;
- exact `dict` with exact accepted `str` keys and accepted values.

Use `type(value) is ...`, never `isinstance`, on caller values. Reject negative or unsafe integers; floats; tuples; sets; bytes-like values; mappings/sequences/iterators; subclasses; enums; dataclasses; functions; and arbitrary instances. Reject non-string dictionary keys.

Every accepted string/key must already be NFC and contain no surrogate, U+FDD0–U+FDEF noncharacter, or scalar whose low 16 bits are FFFE/FFFF. Strings are never normalized or rewritten.

## Local validation and snapshot algorithm

Validation/snapshot order is exact:

1. dispatch by exact type;
2. for a string, reject `len(value) > 1_048_576` before normalization or whole-string copying;
3. scan code points without constructing a derivative string, rejecting forbidden scalars and accumulating UTF-8 width with immediate per-string rejection above `1_048_576` bytes;
4. add each string/key occurrence's UTF-8 width to a call-global raw-string-byte counter and reject immediately above `16_777_215` before normalization or dependency access;
5. only then require `value == _unicodedata.normalize('NFC', value)`;
6. for containers, enforce depth, cumulative occurrence entry count, and active-path cycle identity before descending;
7. append/store only validated children in fresh local exact built-in containers; remove active identity in `finally`;
8. call `_rfc8785.dump(snapshot, bounded_sink)` only after the complete snapshot succeeds;
9. append one LF through the same sink and return `bytes(private_bytearray)`.

The aggregate raw-string ceiling is an equivalent early consequence of the final byte ceiling: canonical JCS contains every accepted raw UTF-8 string/key byte plus quoting/syntax, so any graph above `16_777_215` raw bytes cannot fit in an accepted `16_777_216`-byte result including LF. It is enforced before dependency sorting because RFC 8785 sorting materializes UTF-16 key bytes; this keeps total sort-key material bounded rather than allowing 100,000 individually valid 1 MiB keys.

## Resource limits

Inclusive limits:

- root depth `0`; maximum container depth `64`;
- cumulative list-element plus dictionary-entry occurrences `100_000`;
- one string/key `1_048_576` UTF-8 bytes;
- aggregate string/key occurrences `16_777_215` raw UTF-8 bytes;
- final JCS bytes plus one LF `16_777_216` bytes.

A private sink accepts only exact built-in bytes from the pinned dependency, rejects a write before extending its `bytearray` when the new total would exceed the final limit, and exposes no file-like methods beyond the required private `write`. Dependency serialization can transiently quote one validated at-most-1-MiB string and sort at most 100,000 dictionary references. Dependency list/dict copies are bounded by the same occurrence limits. PF0A claims application-reference bounds, not native allocator release timing.

If the dependency calls `write` with anything other than exact built-in `bytes`, the sink raises a fresh exact built-in `RuntimeError` with exact message `invalid RFC 8785 sink write`; this is an unexpected dependency/protocol defect and propagates unchanged. Output overflow raises the private local domain signal and is converted to the fixed public `TypeError` because the caller value exceeds PF0A's accepted resource domain.

## Canonical wire contract

The dependency owns RFC 8785/JCS serialization. The adapter adds exactly one final LF. There is no BOM or byte after LF.

Primary fixture, including LF:

```text
7b2261223a302c227a223a5b747275652c6e756c6c2c225c625c745c6e5c665c725c225c5c2f5c7530303031e280a8e280a9225d7d0a
```

Ordering fixtures, including LF:

```text
UTF-16 inversion: 7b22f0908080223a312c22ee8080223a327d0a
shared prefix:    7b2261f0908080223a312c2261ee8080223a327d0a
proper prefix:    7b2261223a312c226161223a327d0a
```

Maximum accepted integer, including LF:

```text
393030373139393235343734303939310a
```

The RFC 8785 UTF-16 order intentionally differs from rejected standard-library PF0A scalar ordering. No old fixture or approval transfers.

## TDD and dependency environment

PF0A owns exactly two external temporary paths during implementation:

- dependency environment `/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137`;
- syntax-verification bytecode tree `/tmp/bpm-pf0a-pycache`.

Task 1 requires the dependency-environment path absent, creates it once with repository-shell Python `3.13.7`, and installs from the tracked hash lock. Task 6 separately requires the bytecode-tree path absent immediately before its sole creating command. An unexpected pre-existing path at either exact location is a stop, not something to delete blindly. Record `PF0A_PYTHON=/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137/bin/python` in session evidence. The dependency environment remains immutable through implementation review. The bytecode tree is non-authoritative generated state: no test, review, commit, or later stage may consume its contents. Both paths remain exact non-symlink directories and are removed only after the approved implementation commit by the cleanup gate below.

Every test command uses `PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -m unittest ...`. Add one named test at a time. Run that exact method, then the owning file. A missing-module `ERROR` is valid only for the first adapter behavior. Later absent adapter behavior must fail through the intended assertion or exception mismatch; upstream-provided wire behavior may be predecessor GREEN and receives no manufactured production change.

The test class is exactly `CanonicalJsonTests`. The first adapter RED command is literal:

```bash
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -m unittest -v scripts.test_lifecycle_proof_canonical_json.CanonicalJsonTests.test_c1_null_bytes
```

For each later method, substitute only the exact method identity already listed in this plan. Before trusting any focused result, require output containing that full `CanonicalJsonTests.test_...` identity and exactly one `Ran 1 test` line. Then run the complete owner:

```bash
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -m unittest -v scripts/test_lifecycle_proof_canonical_json.py
```

Task 1's environment-creation block is the sole exception to the reusable post-install checkpoint because `PF0A_PYTHON` does not exist yet. Before that block, run the Task 0 repository/document checks through the visible-untracked allowlist but omit only the four external-environment assertions (`PF0A_PYTHON` presence/path/version/package identity). Immediately after installation, run the complete reusable checkpoint; every subsequent case/block uses it.

## Task 0: exact-byte documentation approval and commit

Obtain three approvals of one exact design/plan/sidecar identity. Then set approved digests and run the exact docs-only checkpoint:

```bash
set -euo pipefail
: "${APPROVED_DESIGN_SHA256:?}"
: "${APPROVED_PLAN_SHA256:?}"
python3 -c 'import re,sys; assert all(re.fullmatch(r"[0-9a-f]{64}", x) for x in sys.argv[1:])' "$APPROVED_DESIGN_SHA256" "$APPROVED_PLAN_SHA256"
test "$(git branch --show-current)" = "feat/m2-one-track-vertical-slice"
test "$(git rev-parse HEAD)" = "c7636c17f595bea7a61cb5f20a87d18933cc6df2"
test "$(shasum -a 256 docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md | cut -d ' ' -f 1)" = "$APPROVED_DESIGN_SHA256"
test "$(shasum -a 256 docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | cut -d ' ' -f 1)" = "$APPROVED_PLAN_SHA256"
test -z "$(git diff --name-only)"
test -z "$(git diff --cached --name-only)"
test "$(git ls-files --others --exclude-standard | LC_ALL=C sort)" = "$(printf '%s\n' docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | LC_ALL=C sort)"
git add -- docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md
git diff --cached --check
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "$(printf '%s\n' docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | LC_ALL=C sort)"
git commit -m "docs: adopt RFC 8785 proof foundation"
DOC_COMMIT=$(git rev-parse HEAD)
export DOC_COMMIT APPROVED_DESIGN_SHA256 APPROVED_PLAN_SHA256
test "$(git rev-parse "${DOC_COMMIT}^")" = "c7636c17f595bea7a61cb5f20a87d18933cc6df2"
test "$(git show -s --format=%s "$DOC_COMMIT")" = "docs: adopt RFC 8785 proof foundation"
test "$(git diff-tree --no-commit-id --name-only -r "$DOC_COMMIT" | LC_ALL=C sort)" = "$(printf '%s\n' docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | LC_ALL=C sort)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Do not push.

Before every later case/block, require exact `DOC_COMMIT`, approved hashes, no tracked/staged drift, and visible untracked paths as a subset of the three implementation files:

```bash
set -euo pipefail
: "${DOC_COMMIT:?}"
: "${APPROVED_DESIGN_SHA256:?}"
: "${APPROVED_PLAN_SHA256:?}"
: "${PF0A_PYTHON:?}"
test "$(git branch --show-current)" = "feat/m2-one-track-vertical-slice"
test "$(git rev-parse HEAD)" = "$DOC_COMMIT"
test "$(shasum -a 256 docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md | cut -d ' ' -f 1)" = "$APPROVED_DESIGN_SHA256"
test "$(shasum -a 256 docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | cut -d ' ' -f 1)" = "$APPROVED_PLAN_SHA256"
test -z "$(git diff --name-only)"
test -z "$(git diff --cached --name-only)"
git ls-files --others --exclude-standard | python3 -c 'import sys; allowed={"requirements/lifecycle-proof.txt","scripts/lifecycle_proof_canonical_json.py","scripts/test_lifecycle_proof_canonical_json.py"}; actual={x.rstrip("\n") for x in sys.stdin}; assert actual <= allowed, sorted(actual-allowed)'
test "$PF0A_PYTHON" = "/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137/bin/python"
test "$($PF0A_PYTHON --version)" = "Python 3.13.7"
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -c 'import importlib.metadata,rfc8785; assert importlib.metadata.version("rfc8785")==rfc8785.__version__=="0.1.4"'
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -c 'import hashlib,pathlib,rfc8785; root=pathlib.Path(rfc8785.__file__).parent; expected={"__init__.py":("fa44927afd547caf7547247078bcf28863d1e69caf116d258c532b3f20ffd154",496),"_impl.py":("c25bc3a046528482d53bee3487b837f31dd9c05f33e8f13288c7aab320932cec",7251)}; actual={name:(hashlib.sha256((root/name).read_bytes()).hexdigest(),len((root/name).read_bytes())) for name in expected}; assert actual==expected,(actual,expected)'
python3 -c 'from pathlib import Path; bad=[str(p) for p in Path("scripts/__pycache__").glob("*") if p.name.startswith(("lifecycle_proof_canonical_json.","test_lifecycle_proof_canonical_json."))]; assert not bad,bad'
```

## Task 1: dependency lock, environment, and first scalar RED/GREEN

Create the exact lock file and test file first. Build the external environment:

```bash
set -euo pipefail
python3 --version | grep -Fx "Python 3.13.7"
test ! -e /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test ! -L /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
python3 -m venv /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
PF0A_PYTHON=/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137/bin/python
export PF0A_PYTHON
"$PF0A_PYTHON" -m pip install --disable-pip-version-check --only-binary=:all: --no-deps --require-hashes -r requirements/lifecycle-proof.txt
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -c 'import importlib.metadata,rfc8785,sys; assert sys.version_info[:3]==(3,13,7); assert importlib.metadata.version("rfc8785")==rfc8785.__version__=="0.1.4"'
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -c 'import hashlib,pathlib,rfc8785; root=pathlib.Path(rfc8785.__file__).parent; expected={"__init__.py":("fa44927afd547caf7547247078bcf28863d1e69caf116d258c532b3f20ffd154",496),"_impl.py":("c25bc3a046528482d53bee3487b837f31dd9c05f33e8f13288c7aab320932cec",7251)}; actual={name:(hashlib.sha256((root/name).read_bytes()).hexdigest(),len((root/name).read_bytes())) for name in expected}; assert actual==expected,(actual,expected)'
```

First add these setup/characterization tests sequentially; they are GREEN after the setup block and authorize no adapter behavior:

- `test_c0_requirement_lock_is_exact` reads the one-line lock as bytes;
- `test_c0_python_version_is_exact`;
- `test_c0_package_version_is_exact`;
- `test_c0_installed_dependency_sources_are_exact` verifies both installed source hashes/counts above.

Then add `test_c1_null_bytes`, import production inside the test loader, and observe the named missing-module `ERROR`. Create the minimal module/function and make exact `b'null\n'` GREEN. Add sequentially:

- `test_c1_false_bytes`;
- `test_c1_true_bytes`;
- `test_c1_zero_bytes`;
- `test_c1_max_safe_integer_bytes`;
- `test_c1_primary_string_escapes`;
- `test_c1_returns_exact_builtin_bytes`;
- `test_c1_returns_fresh_bytes` by encoding the same scalar twice and requiring equal content but distinct identity.

## Task 2: dependency-owned containers and RFC 8785 ordering

Add sequentially:

- `test_c2_list_preserves_order`;
- `test_c2_utf16_inversion_orders_supplementary_first`;
- `test_c2_shared_prefix_uses_utf16_order`;
- `test_c2_proper_prefix_sorts_first`;
- `test_c2_primary_document_bytes`.

The local adapter adds snapshot recursion only. It does not sort, quote, or frame JSON. Ordering/escaping cases already provided by the dependency are predecessor GREEN after recursion exists; record that honestly and make no serializer change.

## Task 3: local Unicode policy

Add sequentially:

- `test_c3_non_nfc_string_rejects`;
- `test_c3_non_nfc_key_rejects`;
- `test_c3_lone_surrogate_string_rejects`;
- `test_c3_lone_surrogate_key_rejects`;
- `test_c3_fdd0_noncharacter_rejects`;
- `test_c3_fdef_noncharacter_rejects`;
- `test_c3_bmp_fffe_noncharacter_rejects`;
- `test_c3_bmp_ffff_noncharacter_rejects`;
- `test_c3_supplementary_10fffe_noncharacter_rejects`;
- `test_c3_supplementary_10ffff_noncharacter_rejects`;
- `test_c3_fdcf_neighbor_accepts`;
- `test_c3_fdf0_neighbor_accepts`;
- `test_c3_fffd_neighbor_accepts`;
- `test_c3_supplementary_10fffd_neighbor_accepts`.

Each local rejection asserts exact built-in `TypeError` and exact fixed message.

## Task 4: exact domain, isolated snapshot, cycles, and errors

Add sequentially:

- `test_c4_negative_integer_rejects`;
- `test_c4_unsafe_integer_rejects`;
- `test_c4_float_rejects`;
- `test_c4_tuple_rejects`;
- `test_c4_set_rejects`;
- `test_c4_bytes_rejects`;
- `test_c4_mapping_rejects` using `collections.UserDict`;
- `test_c4_int_subclass_rejects`;
- `test_c4_str_subclass_rejects`;
- `test_c4_list_subclass_rejects`;
- `test_c4_dict_subclass_rejects`;
- `test_c4_non_string_key_rejects`;
- `test_c4_direct_list_cycle_rejects`;
- `test_c4_direct_dict_cycle_rejects`;
- `test_c4_indirect_cycle_rejects` using dict→list→dict;
- `test_c4_shared_acyclic_child_encodes_twice`;
- `test_c4_caller_containers_are_not_passed_to_dependency` by temporarily replacing `_rfc8785.dump` with a recorder that asserts every list/dict identity differs from all caller container identities and writes fixed valid bytes;
- `test_c4_domain_error_has_exact_type_and_message`;
- `test_c4_domain_errors_are_fresh`;
- `test_c4_normalize_runtime_error_propagates_identity`;
- `test_c4_normalize_memory_error_propagates_identity`;
- `test_c4_dependency_runtime_error_propagates_identity`;
- `test_c4_dependency_memory_error_propagates_identity`;
- `test_c4_dependency_canonicalization_error_propagates_identity`.
- `test_c4_dependency_non_bytes_sink_write_runtime_error_propagates`.

Every injection patches one private imported-module member after import and restores it automatically. There is no production injection seam. Public code catches exactly the private local domain signal and nothing else.

## Task 5: resource endpoints

Add sequentially:

- `test_c5_depth_64_accepts`;
- `test_c5_depth_65_rejects`;
- `test_c5_entries_100000_accepts`;
- `test_c5_entries_100001_rejects`;
- `test_c5_ascii_string_bytes_1048576_accepts`;
- `test_c5_ascii_string_bytes_1048577_rejects_before_normalize_or_dependency`;
- `test_c5_ascii_key_bytes_1048576_accepts`;
- `test_c5_ascii_key_bytes_1048577_rejects_before_normalize_or_dependency`;
- `test_c5_multibyte_string_bytes_1048576_accepts` using NFC `é * 524_288`;
- `test_c5_multibyte_string_bytes_1048577_rejects_before_normalize_or_dependency` by adding ASCII `a`;
- `test_c5_multibyte_key_bytes_1048576_accepts`;
- `test_c5_multibyte_key_bytes_1048577_rejects_before_normalize_or_dependency`;
- `test_c5_aggregate_raw_string_bytes_16777215_reaches_dependency`;
- `test_c5_aggregate_raw_string_bytes_16777216_rejects_before_dependency`;
- `test_c5_output_bytes_16777216_accepts`;
- `test_c5_output_bytes_16777217_rejects`.

Rejected early-bound tests independently assert fixture code-point/UTF-8 sizes, then patch normalization and dependency dump with fail-if-called sentinels. The final-output fixtures use exactly 100,000 ASCII strings: 77,214 of content length 165 and 22,786 of length 164 produce 16,777,216 bytes including syntax/LF; lengthen one string by one byte for rejection.

Resource fixtures are literal:

- depth `64`: 65 list containers at depths `0..64` around `None`; depth `65`: 66 containers at `0..65`;
- entries: one root list with exactly 100,000 or 100,001 `None` values;
- ASCII string: root `"x" * 1_048_576` or one extra `x`; ASCII key: that string as the sole key with value `None`;
- multibyte string: NFC `"é" * 524_288` is exactly 1,048,576 UTF-8 bytes; append one ASCII `a` for 1,048,577; multibyte key uses the same verified string as the sole key with value `None`;
- aggregate raw strings: a root list of 15 ASCII strings of length 1,048,576 plus one of length 1,048,575 totals 16,777,215 raw bytes. Patch dependency `dump` with a recorder that asserts it was reached with the private snapshot and writes `b'null'`; the result is `b'null\n'`. The rejected fixture is 16 strings of length 1,048,576, patches dependency `dump` fail-if-called, and rejects while validating the final occurrence;
- output: the exact 100,000-string distribution above; the accepted test asserts exact result length, exact `bytes`, and final LF; rejected cases assert the fixed local `TypeError`.

## Task 6: source/dependency closure and cumulative verification

Add:

- `test_c6_public_exports_are_exact`;
- `test_c6_imports_are_exact` using `ast` to require the two exact imports and no `ImportFrom`;
- `test_c6_dependency_members_are_exact` requiring no `_rfc8785` member except `dump` and no `_unicodedata` member except `normalize`;
- `test_c6_forbidden_builtin_names_are_absent` rejecting loaded names `eval`, `exec`, `open`, `input`, `print`, `breakpoint`, `compile`, `__import__`, `getattr`, `setattr`, `globals`, or `locals`;
- after refactor and before staging, `test_c6_production_source_matches_frozen_digest`, whose expected SHA-256 is computed from the final production file and then remains unchanged through exact-byte review.

The AST test is a narrow executable dependency/builtin surface check, not a claim that a blacklist proves arbitrary Python semantics. Mandatory implementation reviewers read the complete exact production source and reject any parser, callback, hidden side effect, alternate serializer, unexpected exception conversion, or extra authority. Any source or test byte change invalidates that review; the frozen production digest catches unilateral source drift.

Run:

```bash
set -euo pipefail
test ! -e /tmp/bpm-pf0a-pycache
test ! -L /tmp/bpm-pf0a-pycache
cleanup_pf0a_pycache_on_error() {
  status=$?
  trap - ERR
  if test -d /tmp/bpm-pf0a-pycache && test ! -L /tmp/bpm-pf0a-pycache; then
    python3 -c 'import shutil; shutil.rmtree("/tmp/bpm-pf0a-pycache")'
  fi
  test ! -e /tmp/bpm-pf0a-pycache
  test ! -L /tmp/bpm-pf0a-pycache
  exit "$status"
}
trap cleanup_pf0a_pycache_on_error ERR
PYTHONPYCACHEPREFIX=/tmp/bpm-pf0a-pycache "$PF0A_PYTHON" -m py_compile scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py
test -d /tmp/bpm-pf0a-pycache
test ! -L /tmp/bpm-pf0a-pycache
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -m unittest -v scripts/test_lifecycle_proof_canonical_json.py
python3 -m unittest -v scripts/test_generate_gate_track.py scripts/test_static_contract.py scripts/test_verify_gate.py scripts/test_enrollment_static_contract.py scripts/test_stage_pages.py
node --test prototype/one-track/tests/*.test.mjs
python3 -m unittest -v scripts/test_one_track_static_contract.py
python3 scripts/verify_gate.py
trap - ERR
```

The last four commands are cumulative regressions and authorize no modifications to their owners. Expected pre-PF0A baselines are product 129/129, one-track static 11/11, and repository gate 10/10 unless current unchanged repository bytes prove otherwise.

## Task 7: semantic staged candidate, exact-byte review, and local commit

After the reusable checkpoint, stage exactly the three implementation files:

```bash
set -euo pipefail
test "$(git rev-parse HEAD)" = "$DOC_COMMIT"
test -d /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test ! -L /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test -d /tmp/bpm-pf0a-pycache
test ! -L /tmp/bpm-pf0a-pycache
test -z "$(git diff --name-only)"
test -z "$(git diff --cached --name-only)"
test "$(git ls-files --others --exclude-standard | LC_ALL=C sort)" = "$(printf '%s\n' requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py | LC_ALL=C sort)"
git add -- requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "$(printf '%s\n' requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py | LC_ALL=C sort)"
test "$(git diff --cached --diff-filter=DTUXB --name-only)" = ""
test "$(git ls-files --stage requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py | cut -d ' ' -f 1 | LC_ALL=C sort -u)" = "100644"
git diff --cached --check
STAGED_TREE=$(git write-tree)
export STAGED_TREE
python3 -c 'import re,sys; assert re.fullmatch(r"[0-9a-f]{40}",sys.argv[1])' "$STAGED_TREE"
```

External sidecar binds the two docs from `DOC_COMMIT`; three staged paths/modes/blob IDs from the index/`STAGED_TREE`; requirement bytes and wheel hash; production/test bytes; branch/commit; zero unstaged/untracked drift; external Python path/version/package version and installed-source hashes; existence and non-symlink type of both exact external paths; and focused/cumulative outputs. The bytecode tree is an owned cleanup obligation, not reviewed evidence. Reviewers use read-only Git commands and must not consume or modify bytecode-tree contents, install, compile, modify the dependency environment, modify the index, or edit files.

Three independent reviewers must approve specification/privacy, architecture/security/supply-chain, and TDD/workspace/maintainability on the same bytes. Any rejection, timeout, stale identity, duplicate reviewer, dependency mismatch, or drift blocks.

After unanimous approval only:

```bash
set -euo pipefail
: "${DOC_COMMIT:?}"
: "${STAGED_TREE:?}"
test "$(git rev-parse HEAD)" = "$DOC_COMMIT"
test "$(git write-tree)" = "$STAGED_TREE"
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
test "$(git diff --cached --name-only | LC_ALL=C sort)" = "$(printf '%s\n' requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py | LC_ALL=C sort)"
git commit -m "feat: add RFC 8785 proof adapter"
IMPLEMENTATION_COMMIT=$(git rev-parse HEAD)
test "$(git rev-parse "${IMPLEMENTATION_COMMIT}^")" = "$DOC_COMMIT"
test "$(git show -s --format=%s "$IMPLEMENTATION_COMMIT")" = "feat: add RFC 8785 proof adapter"
test "$(git diff-tree --no-commit-id --name-only -r "$IMPLEMENTATION_COMMIT" | LC_ALL=C sort)" = "$(printf '%s\n' requirements/lifecycle-proof.txt scripts/lifecycle_proof_canonical_json.py scripts/test_lifecycle_proof_canonical_json.py | LC_ALL=C sort)"
test "$(git rev-parse "${IMPLEMENTATION_COMMIT}^{tree}")" = "$STAGED_TREE"
test "$(shasum -a 256 docs/design/2026-08-13-staged-executable-lifecycle-proof-contracts.md | cut -d ' ' -f 1)" = "$APPROVED_DESIGN_SHA256"
test "$(shasum -a 256 docs/plans/2026-08-13-lifecycle-proof-f0-contract-foundation.md | cut -d ' ' -f 1)" = "$APPROVED_PLAN_SHA256"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$PF0A_PYTHON" = "/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137/bin/python"
PYTHONDONTWRITEBYTECODE=1 "$PF0A_PYTHON" -c 'import hashlib,pathlib,rfc8785; root=pathlib.Path(rfc8785.__file__).parent; expected={"__init__.py":("fa44927afd547caf7547247078bcf28863d1e69caf116d258c532b3f20ffd154",496),"_impl.py":("c25bc3a046528482d53bee3487b837f31dd9c05f33e8f13288c7aab320932cec",7251)}; actual={name:(hashlib.sha256((root/name).read_bytes()).hexdigest(),len((root/name).read_bytes())) for name in expected}; assert actual==expected,(actual,expected)'
test -d /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test ! -L /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test -d /tmp/bpm-pf0a-pycache
test ! -L /tmp/bpm-pf0a-pycache
python3 -c 'import shutil; shutil.rmtree("/tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137")'
python3 -c 'import shutil; shutil.rmtree("/tmp/bpm-pf0a-pycache")'
test ! -e /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test ! -L /tmp/bpm-music-match-pf0a-rfc8785-0.1.4-py3137
test ! -e /tmp/bpm-pf0a-pycache
test ! -L /tmp/bpm-pf0a-pycache
```

Do not push. Cleanup of both exact external resources is local resource release, not approval-byte mutation. Approval authorizes designing PF0B only, not implementing it.

## Acceptance and stop conditions

PF0A completes only when the exact docs and exact implementation each receive three approvals; the wheel hash/version and Python runtime match; all focused/cumulative tests pass; only the five approved docs/implementation files constitute the reviewed chain; and docs/implementation commits satisfy the exact parent/tree/membership gates with no push.

Stop without implementation or further automatic revision if this dependency-backed plan is rejected twice; the wheel or pinned public behavior differs; the adapter cannot bound snapshot/output without reimplementing JCS; package installation requires unpinned transitive code; complete source review finds parser/callback/side-effect authority; or any filesystem/Git/manifest/verdict/lock/CLI/product/browser/private-fixture/deployment concern enters PF0A.
