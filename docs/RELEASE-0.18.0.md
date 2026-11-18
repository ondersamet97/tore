# töre 0.18.0 — töre opens on your map

Released 2026-11-18; published 2026-11-21 together with 0.16.0 and 0.17.0. See the 0.18.0 entry in [CHANGELOG.md](../CHANGELOG.md). It includes the personality test (`/kisilik`), described in [KISILIK-TESTI.md](KISILIK-TESTI.md).

Also in this release: topic suggestions use a general set of themes; the opinion catalogue ships with a single synthetic example; thinker cards show the years each thinker lived and the context of their view; an unused integrations page was removed.

## Stored data

Unchanged apart from the optional `fromPasted` flag on report items, which is absent when false.

## Checks

| Command | Result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml` | all passed (the local-port test needs a run outside the sandbox) |
| `local-reader/tests/canvas-ui.test.cjs` | 9 passed (jsdom, synthetic data) |
| Browser check, synthetic data, 1440 px and 375 px, TR and EN | 44 checks passed |

Not checked: a real trackpad pinch, a touch device and a screen reader.
