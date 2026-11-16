# töre 0.12.1 — Open-source licence and a narrower scope

Released 2026-11-16.

## What changed

- **Licence.** The original code is offered under the GNU Affero General Public License v3 (AGPL-3.0-only). `LICENSE` is the unmodified licence text (SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`). A separate commercial licence is available from the owner; see `COMMERCIAL-LICENSE.md`.
- **Licence history.** 0.11.0-rc.4 and the first public version, 0.12.0, were offered under PolyForm Noncommercial 1.0.0. Rights granted for those versions under that licence are not withdrawn. This note is not legal advice.
- **Dream notebook removed.** The experimental `/ruyalar` page, its storage, its suggestion rules and the training-dataset export are no longer part of töre. töre does not produce AI-training datasets. A `dreams-v1.json` file created by 0.12.0 stays on disk untouched and is no longer read.
- **About and contact.** `ABOUT.md` describes who builds töre and why. `CONTRIBUTING.md` explains that issues are welcome and code contributions wait for a contributor agreement.
- **Wording.** The README says consistently that töre proposes source-linked candidates and the person confirms each one.

## Unchanged

Topics, the review queue, source-linked records, manual continuation and the thinkers catalogue work as in 0.12.0. Third-party components keep their own licences.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 133 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 168 passed, 0 failed |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.

## Screenshots

The images in `docs/images/` were taken from the real interface on a fresh, empty data folder filled only with a synthetic example (a fictional neighbourhood library).
