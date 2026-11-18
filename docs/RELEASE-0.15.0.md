# töre 0.15.0 — Claude Code plugin, trash and a clean start

Released 2026-11-17.

## What changed

- **Claude Code plugin.** [tore-claude-plugin](https://github.com/ondersamet97/tore-claude-plugin) is a separate repository. It contains a launcher, a skill that continues from a topic, and a `/tore:propose` command. It bundles no data: at install time you enter the path of your own töre checkout, and it starts `tore-server mcp` from there with your own notebook.
- **Trash.** "Çöp kutusuna taşı" hides an opinion, decision, question or task from every view, the map, thinkers, the inbox and the connected AI tool. "Silinenler" under Bakım restores it, or deletes it permanently with a separate consent; töre takes a backup first. Records that history depends on stay in the trash and cannot be permanently deleted.
- **Open every topic at once.** A "Bağlı AI aracı" panel at the top of **Konularım** opens all existing topics for reading, optionally with proposals, with one explicit consent; "Hepsini kapat" removes every permission. Topics created later start closed.
- **Connector survives updates.** A running MCP connector skips records written in a newer format instead of failing, rejects unknown schema versions, and returns a message asking the person to reconnect when the notebook cannot be read. stderr names only the error kind and field.
- **A clean start.** `Preview.command` and the demo script are removed. `Başlat.command` is the only launcher; a new checkout starts with an empty notebook. Server messages no longer call töre a demo.
- **No personal details in public files.** The README, notices and test fixtures carry no personal details; contact goes through the töre LinkedIn page or the contact page on the website.

## Stored data

Trashed records carry `trashedAt`. A notebook with a trashed record cannot be opened by 0.14.x; the 0.15 connector reads notebooks written by 0.14.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner. The plugin is AGPL-3.0-only as well.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 164 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 210 passed, 0 failed |
| `claude plugin validate --strict` on the plugin | passed |
| Plugin launcher over stdio against a synthetic notebook | a closed topic stays hidden; decision, question and task labels are kept; a proposal lands in the inbox |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.
