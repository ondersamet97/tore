# töre 0.14.0 — Working from töre: tasks, two-way MCP and a simpler interface

Released 2026-11-17.

## What changed

- **Tasks.** A fourth record kind, *iş*. A task is open or closed, like a question; it is never an adopted belief, and only you close it. "Kaldığım yer" lists open tasks, with the ones you marked active first.
- **A connected AI tool can work on a topic.** On **Konularım** you can open a topic to Claude Code (or another MCP client) for reading, and separately allow it to leave proposals. The tool sees your adopted, current decisions and opinions, open tasks and open questions of that topic only.
- **Proposals wait in an inbox.** The tool never writes the notebook. A proposal (a task result, a decision, a question, a task or an objection to one of your positions) waits in **Gelen kutusu** with the tool's name. Accepting it makes a pending record marked as an AI proposal; dismissing it removes it. Nothing a tool writes is adopted or closes a task by itself.
- **Claude Code sessions.** On **Konuşmalarım** you can list the Claude Code sessions kept on this computer and import the ones you choose through the usual preview. Only what you typed and the assistant's visible answers are kept.
- **A simpler interface.** One menu on every page, one vocabulary, a light theme everywhere, a first step on every empty page, one-click review with an optional reason, "save and next" in the review queue, errors shown next to the button that caused them, fewer confirmation boxes on reversible actions, and accessibility fixes (contrast, focus, narrow screens, reduced motion).

## Stored data

Tool access (`toolAccess`) and handled proposals (`inboxHandled`) are stored in the topic notebook only when used, so notebooks without them keep their hashes. Proposals themselves are in `conversations/tool-inbox.jsonl`. A notebook that holds a task, tool access or an accepted tool proposal cannot be opened by 0.13.x.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 156 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 208 passed, 0 failed |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.
