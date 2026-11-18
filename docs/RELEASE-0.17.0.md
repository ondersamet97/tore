# töre 0.17.0 — Reports from Claude Code conversations and surpassed thoughts

Released 2026-11-18; published 2026-11-21 together with 0.16.0 and 0.18.0.

## What changed

See the 0.17.0 entry in [CHANGELOG.md](../CHANGELOG.md) and the "Raporlar ve aşılmış düşünceler" section of [RECORDS-CONTRACT.md](RECORDS-CONTRACT.md).

## Stored data

New fields (`reports`, `reportProjects` in the topic store; `supersededBy`, `supersededAt`, `supersessionReason` on records) are not written until used, so older stores and backup hashes stay byte-identical. Report items keep only what the person may decide on: the proposed text, its reason, the exact quote and its message id.

## Model calls

A report sends one chosen conversation (the person's turns up to 3500 characters each, the assistant's up to 450) and the person's active thoughts (up to 150, 300 characters each) to the person's own Claude Code. Nothing is sent in the background or on page load.

## Checks

| Command | Result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml` | all passed (the local-port test needs a run outside the sandbox) |
| `node --check` on changed web files | passed |
