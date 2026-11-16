# Change log

## 0.13.0 — Map of my thinking, view testing and the MCP adapter (2026-11-16)

### Map of my thinking

- Add **Haritam** (`/harita`): a reader-facing arrangement of notebook records into nine fixed sections (starting points, how a person should live, how a society should live, knowledge and method, history, technology and AI, belief, economy, art) and eight roles (premise, position, divergence, change of view, objection, answer, refutation criterion, open question).
- An entry only places an existing record. Source, attribution, review, adoption and history stay on the record; the map never infers, scores or labels a person.
- **View testing:** objections, answers and refutation criteria hang from a position. Each position shows how many objections it has, how many are answered and whether a criterion is stated. New objections, answers and criteria are written as new notebook records by the person.
- Entries carry a `placement`: `user`, or `suggested` when an assistant proposed the place. Editing an entry makes the placement the person's own. Suggested placements can be hidden and are excluded from exports unless requested.
- Pending records can be reviewed in place ("Bu benim görüşüm" / "Benim görüşüm değil"), each behind an explicit checkbox.
- **English view:** an optional English translation per entry, labelled as an AI translation or the author's own; the original stays visible. Reader strings and the catalogue are bilingual.
- **Single-file export** (`map-export`): a self-contained, script-free HTML document in Turkish or English, written only with explicit consent. Default scope is reviewed, not rejected, not superseded records; pending and suggested entries are opt-in and marked. Conversation titles, topic titles and identifiers are not included. A local private-information scan reports possible matches. Nothing is sent anywhere.
- New local operations: `map`, `map-add`, `map-update`, `map-remove`, `map-export`. Entries live in the topic notebook (`mapEntries`) and share its lock, atomic write, backups and restore validation. An empty map is not serialized, so existing store and backup hashes are unchanged.
- Navigation shows **Haritam** on the notebook pages.

### MCP adapter

- Merge the read-only MCP adapter: `tore-server mcp --data <folder>` serves, over stdio, exactly the continuation contexts the person opened with `records-share`. See `docs/MCP.md`.

## Unreleased

- **Connected AI tool (MCP), read-only.** A prepared continuation context can be opened to an AI tool on the same computer (first target: Claude Desktop and Claude Code) with its own consent checkbox, separate from the copy consent, and closed again with one click. The tool can read exactly that text while it is open, and nothing else from töre.
- New operation `records-share` stores the consent on the packet (`sharedWithTools`). The field is omitted while false, so existing stores, backups and their hashes are unchanged until the feature is used. Restoring a backup never reopens sharing.
- New invocation `tore-server mcp --data DIR`: a stdio MCP server with two read-only tools, `tore_list_shared_contexts` and `tore_get_shared_context`. It starts no HTTP server, takes no lock, never writes and reads the notebook afresh on every call. See `docs/MCP.md`.

## 0.12.2 — Data-package tool removed (2026-11-16)

- Remove the "Veri paketi" tool from Konuşmalarım: the `dataset` intent, the `export` operation and the `dataset.jsonl` / manifest / README package with a research or model-training purpose. töre no longer has any tool that turns conversations or notes into a dataset.
- Continuing a conversation with another model (the `continue` intent) is unchanged. Drafts saved by older versions with the removed intent still load, are shown as no longer supported and cannot be executed.

## 0.12.1 — Open-source licence and a narrower scope (2026-11-16)

- **Licence.** The original code is offered under the GNU Affero General Public License v3 (AGPL-3.0-only) from this version. A separate commercial licence is available from the owner for uses that cannot meet the AGPL terms. 0.11.0-rc.4 and 0.12.0 were offered under PolyForm Noncommercial 1.0.0; rights granted for those versions are not withdrawn.
- **Dream notebook removed.** The experimental `/ruyalar` page, its storage, its rules and the training-dataset export are no longer part of töre. Existing `dreams-v1.json` files are left untouched on disk and are no longer read.
- Add `ABOUT.md`, `COMMERCIAL-LICENSE.md` and `CONTRIBUTING.md`.
- The README describes candidate proposal consistently: töre proposes source-linked candidates and the person confirms each one.

## 0.12.0 — Thinkers, dream notebook and first public source (2026-11-16)

- First version published as a public repository. The public repository receives one commit per release, built from an allowlist (`scripts/export-public.py`); private Git history, personal stores and internal verification records are not part of it.
- The topic-notebook navigation shows **Düşünürler** and **Rüyalarım** on every page.
- No licence change: PolyForm Noncommercial License 1.0.0, source-available, not open source.

### Thinkers

- Add a versioned, editorial catalog of eight thinkers (Gökalp, Hegel, Ibn Khaldun, Gellner, Weber, Hobbes, Fichte, Schmitt) with works, ideas, criticisms and stated limits. Public, general information only; no personal views are written into the source.
- Add a **Düşünürler** page (`/dusunurler`) where the person links their own notebook records to a thinker, with an optional note. Linking and unlinking require explicit consent; no affinity score, ranking or identity inference.
- Store links inside the topic notebook (`thinkerLinks`), so they share its lock, atomic write, backups and restore validation. Empty links are not serialized; existing store and backup hashes are unchanged.
- New local operations: `thinkers`, `thinkers-link`, `thinkers-unlink`. No network calls, models or paid services.

### Dream notebook (experimental)

- Add `/ruyalar` (Rüyalarım): record a morning dream in your own words, get offline rule-based code suggestions (characters, emotions, settings, themes), confirm them and write a user-edited anonymized text. A timer shows how long the entry took; the target is under three minutes.
- The original report is the user's statement and cannot be edited after saving; rule suggestions are kept apart from confirmed codes.
- Add per-dream training-use consent and `dreams-export`: a JSONL dataset plus manifest containing only consented, user-confirmed dreams with no remaining known personal-data patterns, month-level dates and hashed IDs. Not a sale or licence; anonymity is not guaranteed.
- Store dreams in `dreams-v1.json` next to the other workspace files with the same lock, atomic-write and fail-closed rules. No network access, no voice upload: dictation uses macOS's own feature.

## 0.11.0-rc.4 — Licence change (2026-11-15)

- Offer the original code under the unmodified PolyForm Noncommercial License 1.0.0 from this version. Uses the licence does not permit, in particular commercial use, require the owner's separate written permission.
- Versions up to 0.11.0-rc.3 were prepared under AGPL-3.0-only; rights already granted under those terms are not withdrawn and Git history is not rewritten.
- Synchronize `LICENSE`, `NOTICE.md`, package metadata, README and the licence documents. Third-party licences and notices are unchanged.
- No functional change. The project is source-available, not open source. No publication, deployment or repository visibility change.

## 0.11.0-rc.3 — Topic overview and review queue (2026-11-15)

- Add a global overview and filtered pending-review queue, using the existing source-aware editor.
- Organize previously uncategorized conversation links into local topic groups and source-based subtopics.
- Preserve original conversations, record content, review history, approvals, and saved contexts; keep topic moves in an audited, backed-up operation.
- Add synthetic organization coverage and a local-only migration verification tool. No models or paid services are invoked.

## 0.11.0-rc.2 — Existing archive migration (2026-11-15)

Local bulk topic links and conservative source candidates, preserved legacy endorsements, visible previous opinions and conversation return points. Preview-bound atomic migration, retry protection and backward-compatible backups. No personal data is added to source or public artifacts.

## 0.11.0-rc.1 — Return to a topic (2026-11-15)

Preview preparation: custom topics; source-linked opinion, decision and question candidates; separate review/adoption/currency/priority; preserved revisions and reasons; selected manual context; AI-attributed pasted replies; sidecar backup/restore and explicit legacy migration. The desktop home opens the topic view. Existing imports and opinion tools remain available.

Added synthetic examples, an isolated launcher, English setup/architecture/limitations documentation, licence options, content inventory and fresh verification. Rebuilt compatibility WASM assets with remapped paths. No GitHub visibility change, deployment, application submission, local-model execution or paid request.

This candidate is not yet the `0.11.0 First Public Preview` release: publishing and the proposed commercial-use restriction require a separate decision.

## Earlier versions

0.10 introduced optional cloud/manual ideology workflows and disabled local inference. 0.8–0.9 introduced opinion cards and earlier synthesis work. Historical verification documents in the private working repository are not included in the public candidate and are not evidence that the current candidate passed checks.
