# töre 0.12.0 — Thinkers, dream notebook and first public source

Released 2026-11-16.

## What changed

- **Thinkers (`/dusunurler`).** An editorial catalogue of eight thinkers with works, ideas, criticisms and stated limits. The person links their own notebook records to a thinker, with an optional note. Linking and unlinking need explicit confirmation. There is no affinity score, ranking or identity inference. Links live inside the topic notebook and share its lock, atomic write, backup and restore validation.
- **Dream notebook (`/ruyalar`), experimental.** Record a morning dream in your own words, confirm offline rule-based code suggestions and write an anonymized text. The original account cannot be edited after saving. Per-dream consent controls whether a dream may enter an exported JSONL dataset; the export contains only consented, confirmed dreams without known personal-data patterns, with month-level dates and hashed IDs. It is not a sale or a licence, and anonymity is not guaranteed.
- **Navigation.** Every topic-notebook page links to both new pages.
- **First public source.** From this version each release is published to a public repository as a single commit built from an allowlist by `scripts/export-public.py`. Private Git history, personal stores, credentials and internal verification records are excluded.

## Licence

Unchanged: the original code is offered under the unmodified PolyForm Noncommercial License 1.0.0. The project is source-available, not open source. Commercial use needs the owner's separate written permission. Third-party components keep their own licences. This note is not legal advice.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 137 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 172 passed, 0 failed |

These results establish only the behaviours the tests exercise. They say nothing about model quality, product demand or legal compliance. No model was invoked and no paid request was made.

## Screenshots

The images in `docs/images/` were taken from the real interface on a fresh, empty data folder filled only with a synthetic example (a fictional neighbourhood library and one invented dream).
