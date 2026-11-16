# Connected AI tool (MCP)

Status: released in 0.13.0. Read-only.

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
| `Preview.command` | `<checkout>/.preview-data/runtime` |

The path must be absolute and must not contain symbolic links (on macOS, `/tmp` and `/var` are symbolic links; use `/private/tmp/...` instead). Build the binary first with `bash scripts/build.sh`; it is `server/target/debug/tore-server`.

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
- Both tools carry `annotations` with `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.

## Limitations

- Read-only. The tool cannot save a reply, a record or a review; the person brings replies back.
- The page is in Turkish; the tool descriptions and the preamble line are in English, the context text itself is in the language you wrote it in.
- Verified on macOS only. Only stdio is supported; there is no HTTP transport.
- One notebook per configured server entry; the `--data` path is fixed in the tool configuration.
