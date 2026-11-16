# Töre 0.11.0-rc.1 — executed verification

Date: 2026-11-15. Environment: macOS on Apple Silicon, Rust/Cargo 1.95, Node 26.9.0. Checks used temporary or explicitly synthetic preview stores. No real model request, local inference, payment, credential purchase or public upload occurred.

## Commands and results

| Executed check | Result |
| --- | --- |
| `bash scripts/build-core.sh` | Both compatibility WASM assets rebuilt; macOS/Linux personal-home prefixes absent. The pre-existing core lockfile package version was corrected without changing dependency versions. |
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed. |
| Real Node and browser-target WASM modules, `validate_post`, `validate_follow`, `validate_comparison` with valid fixtures and malformed JSON | 12 calls passed, no network fetch. |
| `bash scripts/build.sh` | Reader generated first, embedded Rust server built second. Version 0.11.0-rc.1. |
| `cargo test --locked --manifest-path server/Cargo.toml` | 109 passed, 0 failed, 1 explicitly ignored optional RSS probe. |
| `cargo test --locked --manifest-path server/Cargo.toml workspace:: -- --test-threads=2` after final target/fixture changes | 90 passed, 0 failed; 20 unrelated tests filtered. Includes all 11 new records tests and exact decompressed Codex fixture equality. |
| `node --test local-reader/tests/*.test.cjs` | 148 passed, 0 failed. Includes 15 new topic-UI tests and actual-server hosted UI tests. |
| `python3 scripts/verify-records.py` | 9 HTTP acceptance stages passed against the compiled server, with outbound traffic restricted to localhost by macOS sandbox. |
| `python3 scripts/verify-opinions.py` | 6 legacy opinion HTTP stages passed against this version. |
| `python3 scripts/verify-ideology.py` | 12 HTTP stages passed; legacy local-generation endpoint remains rejected. No model ran. |
| `node scripts/workspace-e2e.cjs` | 12 existing import, branch, consent, simulation, package, persistence and shutdown stages passed. |
| Playwright CLI real Chromium flow | Topic creation, file import, source-linked correction, manual copy consent, AI attribution, invalid reply retention, question, backup, restart and Gemini/Grok manual preparation passed. Desktop 1440×1050 and mobile 390×844 inspected. No horizontal overflow or visible application errors. |
| Fresh allowlisted source extraction: `npm ci --ignore-scripts`, `bash scripts/build.sh`, topic HTTP acceptance and all Node tests | Build passed; 9 HTTP stages and 148 Node tests passed. Shared system toolchains/caches were used; this is not a fresh-OS certification. |
| `git diff --check` | Passed. |

Detailed local-flow results: [records HTTP report](records-http-report.json), [browser report](preview-browser-report.json). Model quality, live provider availability, OAuth success, market demand and funding eligibility were not tested.

## What the acceptance establishes

A visible conversation excerpt becomes a pending source-linked candidate. Review, endorsement, currency and priority remain independent. Correcting wording preserves the original quote and previous revision. Old decisions and unadopted AI suggestions are excluded from primary current context; AI suggestions require a separately selected, labelled inclusion. Open questions need an explicit closure action and reason.

Manual replies are AI commentary first. Malformed JSON and invented citations are retained with an error and cannot be converted into trusted source candidates. A valid source reference is not a truth judgment. Local backup/restore, stale state checks, corrupt/forged backups, repeat import, legacy endorsement/provenance and restart persistence were exercised. The old opinion and original conversation files remained byte-identical in migration acceptance.

## Failures found and repaired during this run

- Legacy AI interpretations based on user messages initially failed migration validation. Original speaker and AI interpretation attribution now remain separate; regression tests cover all legacy statuses.
- UUID ordering could select an old continuation packet as the latest one. Packet/reply dates are sorted and all saved packets remain selectable.
- The source packager could traverse an allowlisted directory symlink. Path containment and every path component are now validated **before reading**; a synthetic outside-directory symlink was rejected independently.
- The first clean-source Node run lacked three synthetic reader fixtures: 145 passed and 3 failed with missing files. The reviewed synthetic examples were added to the explicit allowlist. The repeated clean-source suite passed 148/148.
- The conversation workspace retained an obsolete version badge; it now reports 0.11.0-rc.1.

No unresolved functional failure remains in the checks listed above. The optional RSS probe was not run. This statement is bounded by the tested workflows, not a guarantee that all bugs are absent.

## Package and publication status

The local source ZIP contains code, embedded-browser source, rebuilt compatibility WASM, reviewed synthetic examples, tests, build/packaging scripts, English documentation, the Turkish licence decision note, dependency notices and `PREVIEW-MANIFEST.json` with file hashes. `.git`, personal stores, old real-data reports, credentials, screenshots, logs, `node_modules`, native executables and build caches are excluded. Synthetic screenshots are separate local review artifacts.

The native **debug** executable contains local build-path metadata and is not included or approved for distribution. Only the scanned compatibility WASM binaries are included. The distribution prepared here is a source candidate; it is not a signed/notarized native application installer.

At the time of this verification, public release was pending the owner's original-code licence choice and the existing AGPL terms were intact. Update 2026-11-15 (0.11.0-rc.4): the owner chose PolyForm Noncommercial 1.0.0 for the original code from 0.11.0-rc.4; public release still requires a separate publication instruction. No repository visibility was changed, no source was uploaded, and no application was submitted. No personal-data conversion was applied automatically. A private pre-upgrade backup and byte-restore check protected the local user's original files; those private details are excluded from this package.
