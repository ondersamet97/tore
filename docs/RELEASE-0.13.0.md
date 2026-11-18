# töre 0.13.0 — Map of my thinking, view testing and the MCP adapter

Released 2026-11-16.

## What changed

- **Map of my thinking (`/harita`).** A reader-facing page that arranges records you already have into nine sections and eight roles: premise, position, divergence, change of view, objection, answer, what would refute it, and open question. The map only places records. Each record keeps its own source quote, review and adoption state, and a record awaiting review is shown as awaiting review.
- **View testing.** Under a position you can write an objection, your answer and the evidence that would change your mind. Each position shows how many objections it has, how many are answered and whether a refutation criterion is stated.
- **Suggested placements stay marked.** When an assistant proposes where a record belongs, the entry is stored as `suggested` and shown as such until you edit or confirm it. Suggested entries can be hidden and are left out of exports unless you ask for them.
- **English view.** Each entry can carry an English translation, labelled as an AI translation or as your own. The original wording always stays visible.
- **Single-file export.** With explicit consent töre writes one script-free HTML file, in Turkish or English, to your computer. By default it contains only records you reviewed and did not reject. Conversation titles, topic titles and identifiers are left out. töre sends the file nowhere; what you do with it is your decision.
- **MCP adapter.** `tore-server mcp --data <folder>` lets Claude Desktop or Claude Code read exactly the continuation contexts you opened, read-only. See [MCP.md](MCP.md).

## What it does not do

- It does not extract your views for you inside the application, call a model, score you or assign a political identity.
- It does not publish anything. The export is a local file.
- A translation marked as an AI translation has not been checked by the author.

## Stored data

Map entries are added to the topic notebook as `mapEntries`. An empty map is not written, so notebooks and backups made by 0.12.x keep their hashes. A notebook that holds map entries cannot be opened by 0.12.x.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 149 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 174 passed, 0 failed |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.
