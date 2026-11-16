# Preview license and publication review

Date: 2026-11-15. Audit baseline: private commit `e4610bfa6fda7e6ad35696346b6e4f3a4ab6de3d` (Töre 0.10.0), with notice additions prepared for 0.11.

> **Update 2026-11-16, 0.12.1.** The owner returned to AGPL-3.0-only for the original code and offers a separate commercial licence (see `COMMERCIAL-LICENSE.md`). The analysis below is kept as a historical record of the earlier decision.

> **Update 2026-11-15, 0.11.0-rc.4.** The owner chose approach A. From 0.11.0-rc.4 the original code is offered under the unmodified PolyForm Noncommercial License 1.0.0, and `LICENSE`, `NOTICE.md`, package metadata and README were synchronized (release gate 1). Third-party terms are unchanged. The audit below was written before that decision at the stated baseline and describes the AGPL status at that time; it is kept as the record of the review. Publication remains blocked pending the remaining release gates and the owner's separate authorization.

**Publication status: blocked pending the owner's license choice and final artifact checks.** This is a decision report, not a new license or legal opinion. The existing `LICENSE` remains AGPL-3.0-only. None of the options below is adopted by this document. Preparing a local preview does not authorize a public repository, upload, deployment, or application submission.

## What is established

The owner stated that the original Töre code is theirs and has no outside contributors. They asked to see commercial-use options before choosing a boundary. Local Git contains four commits with two author labels identifying the same owner. The first commit is an imported project tree; Git does not independently establish the complete history before that import, employment rights, or copyrightability of AI-assisted output.

The existing NOTICE attributes the foundation to the owner's Töre 0.6 and identifies Beyin, İzge, and Rapor as conceptual influences. It says their production databases/services were not copied and that Felsefem Ne was a product reference. The present source/header review found no conflicting original-code attribution, but this is not proof that every upstream origin has been reconstructed. Keep AI-assisted development disclosures accurate.

Third-party components remain under their own licenses. User conversations, opinions, imported reports, and datasets are not included in the software license. Permission to use software is separate from permission to process, share, sell, or train on someone's content.

## Current AGPL position

AGPL permits commercial activity, including charging for copies. It also imposes source and notice obligations where applicable; section 13 addresses users interacting remotely with a modified version. It cannot honestly be described as a prohibition on commercial use. Its existing compliant recipients retain their granted rights; changing a future license does not retroactively remove them. See the [official AGPL text, sections 2, 4, 6, 10 and 13](https://www.gnu.org/licenses/agpl-3.0.html).

A copyright holder can offer their own code under additional licenses, but cannot unilaterally relicense somebody else's contribution. That distinction is supported by the [GNU licensing FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#ReleaseUnderGPLAndNF). The owner's declaration supports preparing options for the original code; it does not relicense dependencies.

The local history and NOTICE indicate a private repository and do not establish whether every historical copy remained private. Do not claim that no prior recipient ever obtained AGPL rights. Keeping the old private history private is a privacy measure, not a way to revoke rights already granted.

A commercial-use restriction makes the proposed future edition **source-available**, rather than open source under the [Open Source Definition's redistribution and field-of-endeavor criteria](https://opensource.org/osd).

## Three approaches to consider

| Approach | What it offers | Fit for this request |
| --- | --- | --- |
| **A. PolyForm Noncommercial 1.0.0 plus separate written commercial permissions** | A standard source-available form, with defined grants and notice requirements. | Worth choosing only if its actual institutional exceptions and distribution grant match the owner's policy. |
| **B. A tailored noncommercial license plus separate written commercial permissions** | Explicit definitions for company use, hosted services, consulting, training, and redistribution. | Best match if the owner wants strict control over all those commercial situations; drafting and legal review are additional work. |
| **C. Business Source License 1.1** | Non-production use initially; an optional additional production grant and a later open license. | Not recommended for a permanent “commercial use only by written permission” policy. |

For A, the actual [PolyForm Noncommercial 1.0.0 text](https://polyformproject.org/licenses/noncommercial/1.0.0) permits noncommercial purposes and personal uses without anticipated commercial application. Its named charitable, educational, public research, safety/health, environmental and government organizations have a broad express permission independent of funding. It also contains a separate distribution grant. Consequently, do not market it as a blanket ban on every institutional activity or paid redistribution; review those cases against the exact text. Its grants include modification and notices must be retained. A separate permission can cover uses outside that standard grant; it must not pretend to withdraw rights that the standard form already gives.

For B, this report recommends writing a plain-language permission policy first, then having a suitable license drafted/reviewed around it. Do not edit the AGPL by adding a “noncommercial” sentence. Define the licensed original files, license version, commercial activities, exceptions, attribution, redistribution, derivative works, patent scope, termination, and the process for written permission. This is a proposed drafting scope, not operative terms.

For C, [BSL 1.1](https://mariadb.com/bsl11/) changes each version to its specified GPL-compatible Change License on the Change Date or its fourth public anniversary, whichever comes first. Its non-production/production distinction also differs from noncommercial/commercial. That is a deliberate future-opening strategy, not a permanent commercial reservation.

**Recommendation:** choose A only if its standard permissions are acceptable unchanged. If company-internal work, paid services, and paid redistribution must all require permission, choose the drafting route B and define the following cases. Keep the preview private until that choice is made.

## Boundaries for the owner to select

This table is a proposed policy for option B. It is not a statement of the current AGPL license and does not override PolyForm or third-party rights.

| Situation | Proposed starting policy | Decision still needed |
| --- | --- | --- |
| A person's private reflection, hobby use, or unfunded learning | Allow without a fee. | Does a professional using it only for personal reflection qualify? |
| Teaching and noncommercial public research | Allow a clearly defined class of activity. | Are tuition-funded courses, funded labs, industry-sponsored research, and private universities included? |
| Charities, government, public health and environmental organizations | Define an express exception or require permission. | Are their paid services and commercial subsidiaries included? PolyForm's named exceptions are broader than a simple nonprofit-income test. |
| Internal use by a company or sole trader | Require written permission if this is the desired commercial boundary. | Include unpaid evaluation, prototype experiments, internal R&D, and pre-revenue startups, or grant a bounded evaluation exception? |
| SaaS, hosting, managed deployments and paid subscriptions | Require written permission. | Is free hosting with advertising, donations, lead generation, or future monetization commercial? |
| Consulting and paid implementation for a client | Require written permission. | Should the consultant, client, or both obtain permission? |
| Selling the app, bundling it in a product, and paid redistribution | Require written permission if legally available for that original edition. | Are cost-recovery copies, app-store distribution, and unmodified mirrors exceptions? |
| Modifying or forking the source | Allow for defined noncommercial purposes. | Require the same terms/attribution on redistributed modifications, and how should commercial forks request permission? |
| Running Töre for commercial AI research, evaluation, or training services | Treat as a commercial software-use case under the chosen policy. | Define research-to-product transition. This grants no rights in user conversations or model/provider material. |
| Training a model on source code, generated exports, or user content | Address each category separately. | A software-use license alone must not be described as a comprehensive content/training-rights contract. |

Written commercial permission can be negotiated per organization or use case without building a payment system now. The owner has not yet approved these starting definitions, pricing, exceptions, or a jurisdiction. No enforceability guarantee is made.

## Third-party review and remediation

Both Rust lockfiles cover 214 unique registry packages; the core packages are a subset of the server lockfile. All now have a declared license and a corresponding notice location. The audit found 23 missing package notice directories and added 48 exact upstream notice files, including nested Unicode and zstd notices. The downloaded/cached crate archive hashes matched `server/Cargo.lock`.

Two Windows support crates omit license files from their published crate archives. Their exact package copyright headers were retained, and their parent upstream release's MIT/Apache texts were added with documented provenance. The r-efi crates carry the full MIT permission and copyright notices in `AUTHORS`. These details are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), the [dependency inventory](../licenses/rust/DEPENDENCY-INVENTORY-0.11.json), and the [added notice provenance](../licenses/rust/NOTICE-SOURCES-0.11.json).

The reviewed declarations expose permissive choices for the dependencies; no mandatory third-party GPL/AGPL-only dependency was identified. “OR” alternatives are different from cumulative “AND” obligations. For example, retaining an alternative GPL text inside zstd does not mean Töre chose that alternative. This is a declaration/notice review, not a blanket compatibility certification.

Rust crate source is fetched by the locked build and is not vendored into the source snapshot. The browser vendors Marked and DOMPurify with their existing licenses. npm's 48 installed build/test packages were reviewed through their package metadata because the lockfile omits license fields; they are not all bundled into the runtime. Do not ship `node_modules` or compiler/build caches as part of the preview.

## Publication and privacy findings at the baseline

The audit examined 516 tracked paths and all 363 unique blobs reachable from four local commits, totaling 4,468,559 blob bytes. Both local branch and remote-tracking refs and the existing release tag were included. This does not include unreachable objects/reflogs, remote-only refs not fetched locally, ignored private data, or credentials.

| Finding | Evidence / classification | Required disposition |
| --- | --- | --- |
| Two compiled WASM files contain workstation paths | `core/pkg/tore_core_bg.wasm` and `core/pkg-node/tore_core_bg.wasm`, 15 embedded Cargo registry paths each. | Rebuild with path remapping or exclude the legacy binaries. Inspect replacement bytes before packaging. |
| Other path-pattern hits | Test-only fabricated paths in source fixtures, including historical versions. | Keep intentional synthetic privacy tests identifiable; do not equate these with real workstation leakage. |
| Provider-token pattern hit | One explicitly synthetic, nonfunctional persistence-test value in `server/src/workspace/tests.rs`. | Keep the synthetic fixture classification; it is not evidence of an exposed account credential. |
| Historical private-use summaries | Real-data test summary/report files and older release reports contain real-use aggregates and verification metadata. No raw conversation body was identified in the reviewed summaries. | Exclude private reports and old release evidence from the public snapshot. Do not convert the existing repository visibility to public. |
| Commit identity metadata | Historical commits include a personal email address. | Keep the private history out of the prospective public snapshot; do not rewrite existing history implicitly. |
| Screenshot | `docs/demo-browser.png` visibly shows synthetic/simulation data, but an old 0.7 screen. | Replace with an explicitly synthetic 0.11 demonstration or omit. Do not present it as current acceptance evidence. |
| Examples | Visible JSON/JSONL fixtures use synthetic source/model identities and test text. | Retain the synthetic-only rule. The compressed fixture must also pass the parser equivalence check in the final run. |

Targeted scans covered common provider/GitHub/AWS token patterns, JWT/private-key markers, long secret assignments, local user paths, and private-network IP patterns. **No genuine credential was identified by these checks.** Pattern scanning cannot prove the absence of every secret or private datum. No account credential, private archive, or ignored personal runtime store was opened for this audit. No secret was uploaded or tested against a service.

The two affected baseline WASM hashes are:

- `core/pkg/tore_core_bg.wasm`: SHA-256 `d78fc2f6676cc91f366dbda74cd5ce851cec7df5d1dada39e9f061fba572b890`.
- `core/pkg-node/tore_core_bg.wasm`: SHA-256 `199f3ba1d17bcc08349fee75abc1b49cad0a6ff2db70587eb3591703f43bc4fa`.

These identify the problematic historical artifacts, not a cleaned release. Private audit details retain match hashes/offsets rather than secret values or workstation-path values.

### Rebuild follow-up

The two working-tree WASM artifacts were rebuilt with `scripts/build-core.sh` and Rust path remapping. An independent byte check on 2026-11-15 found zero macOS/Linux user-home prefixes in both replacement files. The original affected blobs remain in the private Git history; this repair does not clear that history for publication.

| Replacement artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `core/pkg/tore_core_bg.wasm` | 493665 | `45084bccc68a1f734868d006ef48ba710bfe449fefbd883e725882aafe2a4eed` |
| `core/pkg-node/tore_core_bg.wasm` | 493686 | `e3cdcb8a3ac639edd90d7307ababa39ac6ba842a86f172fc70218989f5f30a4d` |

This closes the identified embedded-user-path finding for these working-tree bytes. The final archive still requires its own manifest, byte scan, and synthetic execution checks; the original-code license decision remains open.

A separate local native debug build was reported by the build verification to contain 775 user-home path occurrences. No path values are reproduced here. That native executable is development output and is **excluded from the source ZIP**; its distribution has not been cleared. This preparation delivers a source release candidate with the inspected WASM compatibility assets, not a signed native application. Do not extend the two WASM scan results to a native binary or distribute a local debug build as a release artifact.

The compressed Codex fixture check was also rerun independently after adding a direct decompressed-byte comparison with the plain synthetic JSONL file: `cargo test --manifest-path server/Cargo.toml --locked --offline workspace::importers::tests::public_fixture_files_are_usable_without_private_data -- --exact` completed with **1 passed, 0 failed**. The reviewed packaging script now checks resolved path containment and every parent for symlinks before reading bytes; a synthetic directory-symlink regression was rejected while an ordinary source file was accepted.

## Release gates

1. Choose the original-code license and commercial boundary; if changed later, synchronize LICENSE, NOTICE, package metadata, README, and source scope without altering third-party terms.
2. Use a reviewed, explicit source-file allowlist. Exclude `.git`, private data, old private-use reports, build caches, authentication files, and unreviewed compiled output. Do not push the current private ancestry as the public preview.
3. Rebuild or exclude affected WASM artifacts and inspect all final compiled assets for workstation paths.
4. Re-run the final artifact scan after packaging. A clean source tree is not proof of a clean archive. Record the actual file manifest and hashes.
5. Finish the synthetic clean-install and end-to-end tests for this version; prior test reports are historical evidence only.
6. If a real credential is later identified, stop publication and treat its exposure separately, including revocation/rotation and history/artifact remediation before release.
7. Obtain the owner's separate authorization for the concrete public artifact. No publication has been performed by this review.

Resolving the notice gaps does not resolve the unselected original-code license or authorize publication. This report leaves the existing AGPL file intact so the current legal status is explicit rather than silently changed.
