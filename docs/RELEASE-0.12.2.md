# töre 0.12.2 — Data-package tool removed

Released 2026-11-16.

## What changed

- **The data-package tool is gone.** Konuşmalarım no longer offers "Veri paketi". The server rejects the `dataset` intent, the `export` operation no longer exists, and töre no longer produces `dataset.jsonl`, a manifest or a package README for research or model training.
- Together with the removal of the dream notebook in 0.12.1, this means töre has no feature that turns a person's conversations or notes into a dataset.
- **Unchanged:** continuing a conversation with another model, topics, the review queue, source-linked records and the thinkers catalogue.
- **Older data:** a draft saved by an earlier version with the removed intent still loads, is labelled as no longer supported and cannot be executed. Package files you created earlier stay where you saved them.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 134 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 168 passed, 0 failed |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.
