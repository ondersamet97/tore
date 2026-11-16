# Third-party notice inventory for the 0.11 preview preparation

Reviewed on 2026-11-15. This document records dependency declarations and retained notices. It does not change the license of Töre or any dependency. Original Töre code still uses the existing `LICENSE`; the prospective source-available policy is an unselected option documented in [PREVIEW-LICENSE-REVIEW.md](PREVIEW-LICENSE-REVIEW.md).

## Scope and evidence

| Input | Result |
| --- | --- |
| `server/Cargo.lock` | 216 packages including two local Töre packages; 214 registry packages. |
| `core/Cargo.lock` | 50 packages including the local core; all 49 registry packages already occur in the server set. |
| Host `cargo tree --locked --offline -e normal,build` | 157 unique registry packages in the audited macOS build graph. This is not a bill of materials for every target. |
| `local-reader/package-lock.json` | 48 installed npm build/test packages. Its entries omit license fields; local package manifests supplied the declared licenses. |
| Runtime browser vendors | Marked 18.2.0 and DOMPurify 3.4.17, both duplicated in `vendor/` and `local-reader/vendor/` with license texts. |
| Notice remediation | 23 previously absent Rust notice directories; 48 exact notice files added. Existing notices were preserved. |

The complete registry package/version/license/notice-path mapping is [DEPENDENCY-INVENTORY-0.11.json](../licenses/rust/DEPENDENCY-INVENTORY-0.11.json). Added file sources and SHA-256 values are [NOTICE-SOURCES-0.11.json](../licenses/rust/NOTICE-SOURCES-0.11.json). This inventory is tied to the lockfile hashes in that JSON. Refresh it if dependencies or target features change.

The Rust source package does not vendor crate source. A clean locked build downloads dependencies from their configured registry; an installed cache can permit offline builds. A prepared source archive must exclude `node_modules`, Cargo caches, and target directories. Shipping native binaries for additional platforms requires checking the actual target's dependency/notice scope.

## Browser components

| Component | Declared license | Preserved text / treatment |
| --- | --- | --- |
| Marked 18.2.0 | MIT | `vendor/marked-LICENSE.md`, also in `local-reader/vendor/`. Keep the MarkedJS/Christopher Jeffrey attribution. |
| DOMPurify 3.4.17 | MPL-2.0 OR Apache-2.0 | `vendor/DOMPurify-LICENSE`, also in `local-reader/vendor/`. The permissive Apache alternative is available; keep the actual supplied dual-license text. |
| jsdom 27.4.0 | MIT | Build/test tooling, installed during development; not a browser runtime vendor. |

Among the 48 installed npm packages, the observed declarations were 37 MIT, two MIT-0, two BSD-2-Clause, two BSD-3-Clause, and one each of Apache-2.0, ISC, BlueOak-1.0.0, CC0-1.0, and MPL-2.0 OR Apache-2.0. These are package declarations, not a claim that every transitive file was independently re-authored or relicensed. The installed saxes package has no separate top-level license/notice file; its declared license was recorded, and redistribution of that package would need its upstream notice resolved. No installed npm package directory is included in the source preview.

## Added Rust notices

| Packages | Preserved scope |
| --- | --- |
| adler2 2.0.1 | 0BSD, MIT, Apache alternatives. |
| aho-corasick 1.1.5 | COPYING and MIT license. |
| arbitrary / derive_arbitrary 1.5.0 | MIT and Apache texts from official, checksum-verified crate archives. |
| crc32fast 1.5.5, crossbeam-utils 0.8.23, flate2 1.1.11, jobserver 0.1.35, pkg-config 0.3.34 | MIT and Apache alternatives. |
| miniz_oxide 0.9.1 | Original LICENSE and MIT/Zlib/Apache texts. |
| regex 1.13.1, regex-automata 0.4.18, regex-syntax 0.8.11 | MIT/Apache and regex-syntax's nested Unicode notice. |
| simd-adler32 0.3.10 | MIT text. |
| zip 2.6.1 | MIT text. |
| zopfli 0.8.4 | Apache COPYING. |
| zstd 0.13.5, zstd-safe 7.4.1 | BSD-3-Clause texts. |
| zstd-sys 2.1.3+zstd.1.5.7 | Crate LICENSE, BSD-2-Clause and BSD-3-Clause texts, plus nested zstd LICENSE/COPYING. Respect the cumulative BSD notices; retaining an alternative GPL text does not select it. |
| r-efi 5.3.0 / 6.0.0 | Exact AUTHORS files containing copyright notices, the full MIT grant, and alternative-license information. The MIT option is available; the LGPL alternative is not mandatory. |
| winapi-i686-pc-windows-gnu / winapi-x86_64-pc-windows-gnu 0.4.0 | Exact package copyright headers and the parent upstream 0.3.9 release's MIT/Apache texts. Its target package manifests specify version 0.4.0. |

All 23 crate archive SHA-256 values were checked against the lockfile before copying notices. Only license/notice material was extracted into the repository; archives were not executed or installed. The Windows license texts came through the official [winapi-rs release source](https://github.com/retep998/winapi-rs/tree/0.3.9), because the published support-crate archives omit those files.

Existing notable declarations include Unicode-3.0, CDLA-Permissive-2.0, Apache-2.0 AND ISC, MIT AND BSD-3-Clause, Apache-2.0 with the LLVM exception, and Boost Software License 1.0 as an alternative. **Boost's BSL-1.0 abbreviation is not MariaDB's Business Source License.** Do not collapse an AND expression into a single license or label dependencies with Töre's future commercial restriction.

## Remaining limits

No mandatory GPL/AGPL-only third-party dependency was identified in these declarations. This is not a legal compatibility opinion or a complete source-level supply-chain audit. Original-code ownership before the first imported Git tree is supported by the owner's statement, not independently reconstructed here.

The new original-code license is not selected. Keep current notices intact, define which original files a future license covers, and preserve third-party permissions separately. The final artifact must still pass privacy, compiled-path, synthetic-demo, and clean-build checks. Publication remains a separate user decision.
