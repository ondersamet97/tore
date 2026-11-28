# töre 0.19.0 — The three voices as data, a basis for every proposal, a package that needs no build

Released 2026-11-28. See the 0.19.0 entry in [CHANGELOG.md](../CHANGELOG.md).

## What changed

- **The three voices as structured data.** `tore_get_topic` and `tore_get_shared_context` return their records as MCP `structuredContent`, schema `tore.context/1`, next to their text: id, kind, `voice` (`person`, `ai_suggestion`, and `source` for a quoted source), status, priority, origin and text; a shared context also gives the revision and the quoted source. The four read-only tools declare an `outputSchema`. Fields, the version rule and the limits are in [MCP-STRUCTURED-OUTPUT.md](MCP-STRUCTURED-OUTPUT.md).
- **A topic says where each record's wording came from.** The topic text gains one line per record (`Atıf`) and the structure the matching `origin`: the person's own words, or an AI suggestion they reviewed and kept. This is the one place where this version widens what a connected tool sees of an opened topic; the page where a topic is opened says so.
- **A proposal must say what it rests on.** `tore_propose` requires `basis: {quote, source}` for a `decision` or an `objection` (at most 2000 and 500 bytes; optional for the other kinds). Without it the call is refused and nothing reaches the inbox. The inbox shows the basis as the tool's claim; when the source is a record of the same topic, töre shows that record and says whether the quote appears in it word for word. Taking the proposal into the notebook writes the basis into the reason of the new pending AI proposal.
- **Answers to the tool.** A refused proposal reaches the tool in its own words; before, any refusal whose text had a non-ASCII letter was answered as an unreadable notebook. A data folder töre was never started with answers that no notebook was found there. Messages the server sends to a tool name no AI product and none of its commands.
- **A macOS package that needs no build.** `scripts/package-macos.sh` builds a universal `tore-server` binary and an MCP bundle, `tore-mcp-darwin.mcpb`. See the README.

## What it does not do

- The structured output does not show a tool anything the text does not show. It adds no source quotes, dates, conversations or unreviewed suggestions to a topic.
- It does not prove who wrote a text or who owns it, and it says nothing about the consent of other people who are quoted. Permission to continue a piece of work is not permission to train a model on it.
- töre does not check a basis against the outside world. A quote from a web page, a file or a conversation the tool names is the tool's claim and is shown as such. Only a quote said to come from a record of the same topic is compared with that record.
- A basis does not make a proposal true and does not adopt it. An accepted proposal is still an unreviewed AI proposal.
- Existing permissions are not asked again: a topic that was already open to a tool shows the new origin line from the first call after the update.
- The package is not signed with a developer identity and not notarized by Apple. It has no installer, no automatic update and no uninstaller.
- Nothing here was tried on Windows or Linux, and nobody outside the project has tried this version yet.

## Stored data

- The notebook file (`records-v1.json`) and the record model are unchanged.
- A line in `conversations/tool-inbox.jsonl` may carry `basis`. Lines written by earlier versions are still read. An earlier töre skips a line that carries `basis`: the proposal is not shown there, and it is not lost.
- A record made from a proposal with a basis carries two more lines in its `reason`.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner.

## Checks run on the release tree

| Command | Result |
|---|---|
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 189 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 282 passed, 0 failed |
| `bash scripts/package-macos.sh` on macOS | built on one Mac; the binary holds both architectures, reports 0.19.0 and answers over stdio; the binary contains no home-folder path |

These results establish only the behaviours the tests exercise, on synthetic data. No model was invoked and no paid request was made. Not checked: a connected AI tool reading the structured output in real use, opening the MCP bundle in a tool that installs such bundles, a downloaded copy of the package on a second computer, and any platform other than macOS.
