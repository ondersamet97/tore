# Structured output for connected AI tools (`tore.context/1`)

Status: since 0.19.0. Applies to the MCP server described in [MCP.md](MCP.md).

töre keeps three voices apart in every record:

1. **the source**: the conversation itself, quoted word for word;
2. **the person's own word**: decisions and opinions they reviewed and adopted, and the questions and tasks they keep open;
3. **an AI suggestion**: not a view of the person until they adopt it.

`tore_get_topic` and `tore_get_shared_context` return this distinction twice: as the text they always returned, with its labels, and as MCP `structuredContent`, where the voice is a field and not a sentence. Both tools declare an `outputSchema` in `tools/list`. The two list tools declare an `outputSchema` for the structured listing they already returned; their content is unchanged.

The text is unchanged, byte for byte, for every protocol version. A client that does not know `structuredContent` or `outputSchema` (they exist since protocol `2025-06-18`) ignores the extra members and reads the text as before.

## The privacy rule

**The structured output never says more than the text.** It carries the records the text carries, and for each record only what the text says about it.

- A topic gives the same records as its text: adopted current decisions and opinions, open tasks, open questions, each with its origin. Unreviewed AI proposals, rejected, superseded or trashed records, source quotes, dates, conversations and other topics are in neither form.
- A shared context gives the records the person selected, as they stood when the text was prepared. A record that was revised, superseded or put in the trash afterwards still appears as the shared text shows it, and its later state does not appear at all.
- A field the text does not carry is absent. It is never filled with a guess or a default.
- An error result (unknown, closed or unreadable) has no `structuredContent`.

How this is enforced: a topic's structure is written in the same pass as its text, from the same records and labels. A shared context's entry is given only if the exact lines it is built from are found in the shared text; an entry that cannot be matched is left out, so `records` may hold fewer entries than `recordCount`.

## Top level

`tore_get_topic`:

| Field | Meaning |
|---|---|
| `schema` | `"tore.context/1"` |
| `type` | `"topic"` |
| `topic` | `{id, title, goal}` |
| `proposalsAllowed` | whether `tore_propose` may be used for this topic |
| `hiddenRecords` | number of records this connector could not read and left out |
| `records` | array of records, in the order of the text |

`tore_get_shared_context`:

| Field | Meaning |
|---|---|
| `schema` | `"tore.context/1"` |
| `type` | `"shared_context"` |
| `id` | context id |
| `topic` | `{title}` |
| `createdAt` | when the person prepared the text |
| `declaredDestination`, `model` | where the person said the text was going; `model` is `null` when they did not say |
| `recordCount` | number of records in the shared text |
| `question` | the person's question, shortened to 500 characters as in the listing; the text has it in full |
| `records` | array of records, in the order of the text |

## A record

| Field | In a topic | In a shared context | Meaning |
|---|---|---|---|
| `id` | yes | yes | record id |
| `voice` | yes | yes | `person` or `ai_suggestion`, see below |
| `status` | yes | yes | `adopted`, `open` or `unadopted`, see below |
| `priority` | yes | yes | `unspecified`, `active`, `paused`, `not_priority` |
| `text` | yes | yes | the statement |
| `reason` | if not empty | if not empty | the reason recorded with it |
| `kind` | yes | unless `voice` is `ai_suggestion` | `decision`, `opinion`, `task`, `question` |
| `revision` | no | yes | the revision the shared text was prepared from |
| `origin` | yes | yes | where the wording came from, see below |
| `source` | no | yes | the quoted source, see below |

A topic's text has an origin line (`Atıf`) for every record but no revision or source lines, so a topic's records have `origin` and no `revision` or `source`. The origin line was added to the topic text together with the field: the text and the structure widened in the same step, and the page where the person opens a topic says so. The label of an unadopted AI suggestion does not say whether it was filed as an opinion or a decision, so it has no `kind`. No record carries dates or links to other records: neither text shows them.

### `voice`

- `person`: a record the person holds. With `status: "adopted"` it is a decision or opinion they reviewed and adopted. With `status: "open"` it is a question or a task they keep open; an open question is not an opinion and an open task is not a decision.
- `ai_suggestion`: an AI suggestion the person reviewed and did **not** adopt, which they chose to include in a shared context. It always has `status: "unadopted"`. Never present it as the person's view.
- `source`: only on the nested `source` object. It is the third voice: a quotation, attributed to its speaker.

### `status`

- `adopted`: the person reviewed and adopted it, and it is current.
- `open`: an open question or task. Only the person closes it.
- `unadopted`: an AI suggestion that is not adopted. The record's exact adoption state is not in the text and is not given.

In a shared context the status is the one the shared text states. It is not updated when the notebook changes later.

### `origin`

The record's attribution, in the notebook's own terms:

- `user_authored`: the person wrote the record directly.
- `user_statement`: the record is the person's own sentence, quoted word for word from a conversation.
- `user_interpretation`: the person rewrote something they said in a conversation.
- `assistant_proposal`: the wording came from an AI. With `voice: "person"` this is an AI suggestion the person reviewed and kept; with `voice: "ai_suggestion"` it is one they did not adopt.

### `source` (shared contexts)

`{voice: "source", id, speaker, quote}`: the source line of the record exactly as the shared text gives it. `speaker` is `user` or `assistant`. For a record the person wrote directly, the quote is the record's own text and the id starts with `record:`. Keep a quote attributed to its speaker; a quote of an assistant is not the person's word, even inside a record the person adopted.

## Example

Synthetic data. `tore_get_shared_context`:

```json
{
  "schema": "tore.context/1",
  "type": "shared_context",
  "id": "c4801f44-ff3e-4600-8584-ccd634794950",
  "topic": {"title": "SYNTHETIC topic"},
  "createdAt": "2026-11-28T00:07:44.387067+00:00",
  "declaredDestination": "other",
  "model": null,
  "recordCount": 2,
  "question": "SYNTHETIC question to continue from?",
  "records": [
    {
      "id": "5fe4b306-8bc1-47d8-a57f-790e10bdd312",
      "revision": 2,
      "kind": "decision",
      "voice": "person",
      "status": "adopted",
      "priority": "active",
      "origin": "user_authored",
      "text": "SYNTHETIC decision",
      "reason": "SYNTHETIC reason",
      "source": {
        "voice": "source",
        "id": "record:5fe4b306-8bc1-47d8-a57f-790e10bdd312:v2",
        "speaker": "user",
        "quote": "SYNTHETIC decision"
      }
    },
    {
      "id": "799f2f01-726e-45ba-8bb6-e0a9079a3433",
      "revision": 2,
      "voice": "ai_suggestion",
      "status": "unadopted",
      "priority": "active",
      "origin": "assistant_proposal",
      "text": "SYNTHETIC AI suggestion",
      "source": {
        "voice": "source",
        "id": "tool:cc93d80b-dc37-4c40-9bb5-75c2741e3078",
        "speaker": "assistant",
        "quote": "SYNTHETIC AI suggestion"
      }
    }
  ]
}
```

`tore_get_topic`:

```json
{
  "schema": "tore.context/1",
  "type": "topic",
  "topic": {"id": "433caa35-44d2-475d-bcd0-1ccd7d3b6a4f", "title": "SYNTHETIC topic", "goal": "SYNTHETIC goal"},
  "proposalsAllowed": true,
  "hiddenRecords": 0,
  "records": [
    {"id": "5fe4b306-8bc1-47d8-a57f-790e10bdd312", "kind": "decision", "voice": "person", "status": "adopted", "priority": "active", "origin": "user_authored", "text": "SYNTHETIC decision", "reason": "SYNTHETIC reason"},
    {"id": "9b2d7c44-1e0a-4c6b-8f57-3d2a6e1b9c05", "kind": "opinion", "voice": "person", "status": "adopted", "priority": "active", "origin": "assistant_proposal", "text": "SYNTHETIC AI suggestion the person adopted"},
    {"id": "0a6f3c1e-2a55-4b0e-9d0b-4f6f2b7f5a10", "kind": "task", "voice": "person", "status": "open", "priority": "unspecified", "origin": "user_authored", "text": "SYNTHETIC open task"}
  ]
}
```

## Version rule

- `schema` names the format and its major version: `tore.context/1`.
- Within version 1, fields may be added and enumerations may gain values. A consumer must ignore fields it does not know and must not treat an unknown `voice` or `status` as `person` or `adopted`.
- Removing or renaming a field, or changing what a field or a value means, makes it `tore.context/2`.
- An added field still obeys the privacy rule: it is added to the structure only if the text carries the same information.

## Limits

- **It records a selection, not a proof.** The structure records what the person reviewed, adopted and chose to open in töre. It does not prove who wrote a text or who owns it.
- **It says nothing about other people's consent.** A quote may contain the words of a third person. Opening it to a tool does not show that this person agreed.
- **Permission to continue is not permission to train.** The person opened a text so that one tool can continue a piece of work with them. That is not consent to train a model on it, to store it beyond the task or to pass it on. What a tool does with what it reads is governed by that tool and the person's account with it.
- The fields are as reliable as the notebook: `origin` and `speaker` are what töre recorded when the record was made.
- `question` may be shortened; the text is complete.
- A proposal a tool leaves with `tore_propose` is not part of this output. It can appear only after the person has taken it into the notebook and reviewed it there, under the same rules as any other record.
