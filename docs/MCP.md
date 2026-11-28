# Connected AI tool (MCP)

Status: contexts since 0.13.0 (read-only); topics and the proposal inbox since 0.14.0; a Claude Code plugin since 0.15.0; structured output and the basis of a proposal since 0.19.0. The notebook itself is never written by a tool.

töre can let an AI tool on the same computer read a prepared continuation context directly, through the [Model Context Protocol](https://modelcontextprotocol.io), instead of you copying and pasting it. The first targets are Claude Desktop and Claude Code.

## What it does

- On **Konularım**, after you prepare a continuation context ("Devam metnini önizle"), the preview has a separate section, **Ya da bağlı AI aracına aç**. With its own checkbox you open exactly that text to the connected tool.
- While the context is open the page shows **Bağlı AI aracına açık**, both in the preview and in the list of saved contexts ("Kayıtlı devam metinleri"). One click on **Bağlı AI aracına kapat** or **Kapat** closes it again.
- The connected tool sees two read-only tools:
  - `tore_list_shared_contexts`: the contexts you opened, each with its id, topic title, creation time, the destination you declared, the number of records and your question.
  - `tore_get_shared_context` (`{id}`): the full text of one context, exactly as you saw it in the preview, preceded by one line saying that it comes from töre, that you shared it explicitly, and that labels such as adopted decision, open question and unadopted AI suggestion must be respected.

## What it does not do

- It never returns a context you did not open, a record, a conversation, a reply, a backup or anything else from the notebook. An unknown id and a closed id give the same error, so the tool cannot tell whether a context exists.
- It never writes. The MCP process does not take the notebook lock, does not create files and does not change the store. Replies from the AI tool do not flow back into töre; you bring them back yourself in the reply panel, as before.
- It makes no network requests and sends no telemetry. The tool talks to `tore-server` over stdin/stdout on your computer; what the tool then does with the text (for example sending it to its model provider) is governed by that tool and your account with it.

## Consent model

- Consent is stored per context, on the packet itself (`sharedWithTools: true`), and only through the `records-share` operation with `confirmedByUser: true`. Copy consent and sharing consent are separate checkboxes; one never implies the other.
- Nothing is shared by default. Silence is not consent: a new context, an edited selection or a new question starts closed.
- The MCP server reads the notebook afresh on every tool call, so opening or closing takes effect on the next call, without restarting anything.
- Closing stops future reads. It cannot take back text the tool has already read.
- Restoring a notebook backup always closes every context, even if it was open when the backup was taken.

## Which directory is `--data`

Use the same directory the normal server receives as `--data`, not the archive and not the `conversations` folder inside it:

| Launcher | `--data` directory |
|---|---|
| `Başlat.command` | `<checkout>/.demo-data/runtime` |

The path must be absolute and must not contain symbolic links (on macOS, `/tmp` and `/var` are symbolic links; use `/private/tmp/...` instead). Build the binary first with `bash scripts/build.sh`; it is `server/target/debug/tore-server`.

## Claude Code plugin (easiest)

The [töre plugin for Claude Code](https://github.com/ondersamet97/tore-claude-plugin) sets this up for you and adds a skill to continue from a topic and a `/tore:propose` command:

```
/plugin marketplace add ondersamet97/tore-claude-plugin
/plugin install tore@tore
```

When asked, enter the absolute path of your töre checkout. The plugin contains no data; it starts `tore-server mcp` from your own checkout with your own notebook.

## Connect Claude Desktop

Add an entry to `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "tore": {
      "command": "/absolute/path/to/tore/server/target/debug/tore-server",
      "args": ["mcp", "--data", "/absolute/path/to/tore/.demo-data/runtime"]
    }
  }
}
```

## Connect Claude Code

```sh
claude mcp add tore -- /absolute/path/to/tore/server/target/debug/tore-server mcp --data /absolute/path/to/tore/.demo-data/runtime
```

Then ask, for example, "List my shared töre contexts and continue from the latest one."

## How to revoke

- Close one context: on **Konularım**, open the topic, then click **Kapat** next to the context in "Kayıtlı devam metinleri", or open it and click **Bağlı AI aracına kapat**.
- Disconnect the tool completely: remove the `tore` entry from `claude_desktop_config.json`, or run `claude mcp remove tore`.

## Protocol details

- Transport: stdio, one JSON-RPC 2.0 message per line, UTF-8. stdout carries protocol messages only; short diagnostics without personal content go to stderr.
- Methods: `initialize` (protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05`; the client's version is echoed when supported, otherwise `2025-06-18`), `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Unknown methods return `-32601`, bad parameters `-32602`, unparsable lines `-32700`. Unknown notifications are ignored.
- The read-only tools carry `annotations` with `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- The four read-only tools declare an `outputSchema` and return `structuredContent` next to their text. The text is the same for every protocol version; a client that does not know these members ignores them. See [MCP-STRUCTURED-OUTPUT.md](MCP-STRUCTURED-OUTPUT.md).

## Limitations

- Read-only. The tool cannot save a reply, a record or a review; the person brings replies back.
- The page is in Turkish; the tool descriptions and the preamble line are in English, the context text itself is in the language you wrote it in.
- Verified on macOS only. Only stdio is supported; there is no HTTP transport.
- One notebook per configured server entry; the `--data` path is fixed in the tool configuration.
- A connector keeps running the töre build it started with. After töre is updated, a record written in a newer format is hidden from the older connector, and a notebook it cannot read at all returns an error that asks the person to reconnect the connector in their AI tool (in Claude Code: `/mcp`, choose tore, Reconnect). The reason is written to stderr as error kind and field name only, never record content.
- Messages the server sends to the tool name no AI product and none of its commands. A refused proposal (topic closed for proposals, inbox full, missing basis and so on) is answered in its own words; only a notebook that cannot be read gets the reconnect message.
- If töre has never been started with the configured `--data` folder, every tool answers that no töre notebook was found in this folder yet and asks the person to start töre once with it. Nothing is created.

## Topics and the proposal inbox (0.14.0)

Besides single prepared contexts, you can open a whole topic to the connected tool on **Konularım**.

- **Okumaya aç** lets the tool call `tore_list_topics` and `tore_get_topic`. It sees the topic's title and goal, your adopted and current decisions and opinions, your open tasks and your open questions, each with its record id and, since 0.19.0, its origin: one line (`Atıf`) saying whether the wording is your own (written by you, quoted from you or rephrased by you) or an AI suggestion you reviewed and kept. It does not see unreviewed AI proposals, rejected or superseded records, source quotes, dates, conversations or any other topic.
- **Öneri bırakmasına izin ver** is a second, separate checkbox. With it the tool may call `tore_propose` with a kind (`note`, `decision`, `question`, `task`, `objection`), a text of at most 8000 bytes and optionally `relatesTo`, the id of a record in that topic (required for an objection).
- A proposal is appended to `conversations/tool-inbox.jsonl`. The MCP process still does not take the notebook lock and does not write `records-v1.json`.
- In töre the proposal appears in **Gelen kutusu** with the tool's name. **Deftere al** turns it into a pending record marked as an AI proposal; it is not reviewed and not adopted until you review it like any other record. **Kaldır** discards it. Nothing a tool writes can adopt a view, close a task or close a question.
- Closing a topic takes effect on the tool's next call. Restoring a backup closes every topic.
- A tool can be wrong, and text it read elsewhere can try to steer it. That is why proposals wait in a separate inbox, carry the tool's name and never become your view by themselves.

## The three voices as structured data (0.19.0)

`tore_get_topic` and `tore_get_shared_context` also return their records as structured data, schema `tore.context/1`: each record with its id, kind, `voice` (`person` or `ai_suggestion`; a quoted source is a nested object with `voice: "source"`), status, origin and text. The structure never says more than the text: it holds the same records and, for each, only what the text already shows. Fields, values, the version rule and the limits are in [MCP-STRUCTURED-OUTPUT.md](MCP-STRUCTURED-OUTPUT.md).

## A proposal must say what it rests on (0.19.0)

- When `kind` is `decision` or `objection`, `tore_propose` requires `basis`: `{quote, source}`. `quote` is the exact text the proposal rests on (not empty, at most 2000 bytes). `source` says where the quote comes from: a record id from `tore_get_topic`, or a short description or URL (not empty, at most 500 bytes).
- Without a valid `basis` the call is refused with a tool error in English and nothing is written to the inbox. A `basis` of the wrong shape (not an object, a member missing or not a string, an extra member) is a `-32602` protocol error.
- For `note`, `question` and `task` the `basis` is optional; when given, the same limits apply.
- The basis is stored with the proposal in `conversations/tool-inbox.jsonl`. Lines written before the field existed are still read.
- **Gelen kutusu** shows the quote and its source under the proposal, as the tool's claim and in the AI's colour, never as your words. If the source is a record of the same topic, töre shows that record and says whether the quote appears in it word for word. Anything else is marked as not checked.
- **Deftere al** keeps the basis: it is written into the reason of the new pending AI proposal, worded as the tool's unchecked claim.
- The limits are enforced by the server. The tool still does not take the notebook lock and does not write `records-v1.json`.
