# Change log

## 0.18.0 — töre opens on your map (2026-11-18)

- **Map canvas** (`/` and `/harita`): a pannable, zoomable tree (My map → sections with entries → positions → their divergences, changes, objections, tests, answers and open questions). Thinker names are clickable chips; AI-suggested places and hypotheses look tentative; objections use the objection colour; a ring marks a thought with predecessors. **Look at my whole map** fits every node; **Look at my last thought** goes to `lastDiscussedEntryId`. The side panel (a bottom sheet on narrow screens) shows the person's words or the AI restatement, why it was adopted with the exact quote, the path back to My map, what grew from it, the folded thought inheritance, thinkers and the last-discussed date. Keyboard: Tab, arrows, Enter, Esc; no camera animation with reduced motion. `#entry-<id>` opens a thought. The list map moved to `/harita/liste`; the brand link opens the canvas; the My map sub-navigation is Canvas · List · Thinkers · Surpassed thoughts.
- **Pasted writing.** A report may propose thoughts from a longer text the person pasted and presented as their own writing; such items carry `fromPasted:true` and a label. Texts pasted from others stay out.
- **Fixes.** `predecessors` is ordered nearest first (breadth first); a thought written by hand without a source counts as discussed when it was written, so it can be the last thought.
- **Personality test** (`/kisilik`): the public-domain IPIP-NEO-120 inventory (Johnson, 2014; items from ipip.ori.org), 120 statements on five response options, shown ten at a time in English or Turkish. It is reached by its address only; no menu links to it yet.
- **Raw scores only.** Five dimensions (24–120) and 30 facets (4–20), scored by the IPIP rule: responses 1–5, minus-keyed items reversed, a scale is the sum of its items. There are no norms, so the page never calls a score high or low; a bar shows where the score sits in its possible range. A result is shown only when all 120 statements are answered.
- **Nothing leaves the tab.** Answers are kept in `sessionStorage` (`tore-personality-v1`) and are gone when the tab closes; nothing is written to the notebook, and the page's own script makes no request beyond the interface language (the shared footer still asks for the version line, as on every page). A result becomes a file (Markdown or JSON) only when the person downloads it. Erasing the answers asks once more.
- **The Turkish statements are a draft**: töre's own translation of all 120 items, made from the English originals; no statement is taken from another translation. None has been reviewed by a second translator or back-translated.
- No new server operation; `server/src/assets.rs` serves six new files under the existing policy. Source, limits and the translation review table: `docs/KISILIK-TESTI.md`.
- **Also in this release.** Topic suggestions use a general set of themes. The opinion catalogue ships with a single synthetic example. Thinker cards show the years each thinker lived and the context of their view. An unused integrations page was removed.

## 0.17.0 — Reports from Claude Code conversations and surpassed thoughts (2026-11-18)

- **Update page** (`/guncelle`). Claude Code project folders are listed with their sessions (file facts only); every project starts closed and is opened one by one (`report-projects-set`). The person picks conversations and asks for reports; `report-generate` reads one session, stores it like an import (a session that only grew replaces its older copy) and runs the report model outside every lock. The provider today is the person's own Claude Code: `claude auth status` first (a clear message to run `claude auth login` instead of a long wait), then `claude -p` with no tools and no saved session, stopped after 10 minutes. Prompt and answer format do not depend on the provider.
- **Every proposal is checked.** It must quote one of the person's visible turns word for word; assistant words, missing quotes, unknown kinds, broken links and sensitive patterns (passwords, keys, tokens, wallet addresses) are dropped and counted. At most 12 items per report.
- **Decide item by item** (`report-decide`): `added` creates a reviewed, adopted, current record from the person's quote and places it on the map; `hypothesis` the same as a hypothesis; `declined` keeps a rejected record among surpassed thoughts, optionally linked to the active thought that went beyond it; `later` changes nothing. A decided item cannot be decided again.
- **Surpassed thoughts** (`/asilmis`, `records-supersede`, `records-superseded`). Records gain `supersededBy`, `supersededAt` and `supersessionReason`. Going beyond adds a revision, sets `currency:superseded` and passes the older thought's map place to the newer one. Reviewing a record back to current clears the link. Records in a lineage or created from a report cannot be purged.
- **Map.** Each entry carries `lastDiscussedAt` and its `predecessors`; `lastDiscussedEntryId` names the thought discussed most recently in time. The map page shows "last discussed" and a folded "Thought lineage".
- New fields are absent until used; older stores and backup hashes are unchanged.

## 0.16.0 — A new design, English and Turkish (2026-11-18)

### Look

- **New palette and type.** An off-white ground, ink text, a cobalt accent, turquoise for the AI's voice and coral for objections; serif headings over a sans interface, softer 18-pixel corners and thin rules. Source quotes, your own words and AI proposals each have a distinct visual voice. The application loads no web fonts; it uses system serif and sans faces.
- **The wordmark is "töre"**, without the trailing full stop, on every page.

### Navigation and the topic desk

- **Four-item menu** on every page: Topics · Waiting for you · My map · Conversations. Thinkers sits under My map and Archive under Conversations; every page keeps its address, and the old review address `/konular?view=review` still works.
- **Three-pane topic desk.** A selected topic shows the topic rail on the left (overview, Waiting for you, the topic list, connected-AI-tool status, conversation import and Maintenance), the topic in the centre with a "Where I left off" line and the tabs Now, All records and Map, and a **Source** pane on the right with the clicked record's source excerpt, its conversation title and date. The panes stack below 900 pixels, and between 900 and 1280 pixels the Source pane moves under the topic.
- **One status line per record** replaces the row of state chips. Only an AI suggestion and a record pending review get a distinct mark.

### Waiting for you, first run and import

- **Waiting for you** (`/konular?gorunum=bekleyenler`) combines the review queue and the connected-tool inbox in one list. Pending records come first, grouped by origin, each with its exact source excerpt; proposals from a connected tool follow, grouped by tool and day, with the record they relate to. The page states that töre always asks before anything becomes your view. There is no accept-all: every record is adopted, kept open, left waiting, edited or removed one at a time, and adopting needs the same confirmation as the editor.
- **First run.** With no topics, the topics page shows three steps: where the notebook lives (described, never shown as a path), importing conversations, and opening a first topic.
- **Import receipt.** After an import, a receipt lists what was read, what was skipped and why, and how many records now wait, with a link to Waiting for you. It shows only numbers from the server's answers.

### English and Turkish

- The interface of Topics (with Waiting for you), Conversations, My map, Thinkers, the Archive and the old opinion notebook is available in **English and Turkish**. English is the default; a browser set to Turkish starts in Turkish. An EN | TR switch sits in every top bar and redraws the page in place without losing typed text, selections or open panels.
- **The choice is saved** beside the notebook in `ui-language.json` through two new private operations, `ui-language-get` and `ui-language-set` (`"en"` or `"tr"`), because the loopback port changes on every launch. The file is outside record backups, so restoring a backup does not change the language.
- The map's former Türkçe/English toggle now only chooses the language of the map's content and follows the interface language.

**Still Turkish only:** server-generated content (the thinker catalogue, bulk-placement warnings and reasons, ideology captions), rarer server error messages (common ones are translated in the browser), the starter thinker templates in the archive, legacy development pages, and the launcher's and command-line messages.

### Fixes

- The record picker on Thinkers and My map draws its radio buttons at their normal size; a general form rule had stretched them across the row.

## 0.15.0 — Claude Code plugin, trash and a clean start (2026-11-17)

- **Claude Code plugin.** A separate repository, [tore-claude-plugin](https://github.com/ondersamet97/tore-claude-plugin), packages the MCP connection with a "continue from a topic" skill and a `/tore:propose` command. It bundles no data and starts `tore-server mcp` from the person's own checkout.
- **Connector survives updates.** The MCP reader skips records written in a newer format instead of failing, rejects unknown schema versions, and asks the person to reconnect when the notebook cannot be read. Diagnostics name the error kind and field only, never record content.
- **No personal details in public files.** The README, notices and test fixtures carry no personal details; contact goes through the töre LinkedIn page or the contact page on the website.
- **The demo is gone.** `Preview.command`, the three-minute demo script and its old screenshot are removed. `Başlat.command` is the only launcher; on a new checkout it starts with an empty notebook. Server messages no longer call töre a demo.
- **Trash for every record kind.** "Çöp kutusuna taşı" in the record editor hides an opinion, decision, question or task from every view, the map, thinkers, the inbox and the connected AI tool. "Silinenler" under Bakım lists trashed records. From there a record can be restored, or permanently deleted with a separate consent. töre takes a backup automatically before a permanent delete. Records that history depends on stay in the trash and cannot be permanently deleted. That covers records used in a continuation context, named in a topic organization receipt, migrated from the old opinion notebook, a question with linked answers, or a record with children on the map. New operations: `records-trash`, `records-untrash` and `records-purge`.
- **Open every topic to the connected AI tool at once.** "Konularım" now has a "Bağlı AI aracı" panel at the top: one explicit consent opens all existing topics for reading, optionally with proposals, and "Hepsini kapat" removes every permission. It uses a new `records-tool-access-all` operation that commits all topics in one write. Topics created later start closed. Per-topic permissions still work, and both panels stay in sync.

## 0.14.0 — Working from töre: tasks, two-way MCP and a simpler interface (2026-11-16)

### Tasks

- Add a fourth record kind, **iş** (`task`). A task is open or closed, like a question; it is never an adopted belief, and only the person closes it, with a reason. "Kaldığım yer" lists open tasks (`openTasks`), and continuation contexts label them `AÇIK İŞ — KARAR DEĞİL`. Tasks cannot be placed on the map.

### Connected AI tool, both ways

- **Read a topic.** With consent per topic (`records-tool-access`), a connected tool can list the opened topics (`tore_list_topics`) and read one topic's working context (`tore_get_topic`): adopted, current decisions and opinions, open tasks and open questions. Unreviewed AI proposals, rejected or superseded records, sources and every other topic stay out.
- **Leave a proposal.** With a second, separate consent the tool may call `tore_propose` (note, decision, question, task or objection). The proposal is appended to an inbox file; the notebook is not opened for writing and no lock is taken.
- **Inbox.** `inbox`, `inbox-accept` and `inbox-dismiss`. Accepting creates a record attributed to the tool (`assistant_proposal`, source kind `tool`) that is still pending and not adopted. An accepted objection to a record on the map is placed under it as a suggested placement. Limits: 8000 bytes per proposal, 200 pending proposals, 2 MiB.
- Restoring a backup closes every topic's tool access, as it already did for shared contexts.
- The earlier context tools (`tore_list_shared_contexts`, `tore_get_shared_context`) are unchanged.

### Claude Code sessions

- `claude-code-sessions` lists the session files on this computer (file facts only) and `claude-code-preview` turns chosen sessions into an ordinary import preview. Only typed and visibly answered turns are kept; tool calls, tool output, thinking and subagent turns are left out. Nothing is watched in the background.

### Interface

- One menu on every notebook page (Konularım · Haritam · Düşünürler · Konuşmalarım · Arşiv); the brand always leads to Konularım; the version moved to the page footer. The old opinions page is reached from Konularım's maintenance section and says it is the old notebook.
- One vocabulary across pages (record kinds, review, adoption, source and currency labels); the product name is always lower-case "töre"; internal ids and hashes are no longer shown.
- Every empty page says what it is for and offers one first step.
- One-click review (Benimsedim / Hipotez / Benimsemedim / Açık kalsın) with an optional reason, "Kaydet ve sıradaki" in the review queue and "Kaydet ve benimse" for your own note.
- Errors appear next to the button that caused them and are reworded to say what to do; only the pressed button is locked while an action runs; focus and scroll position are kept after an action.
- Confirmation checkboxes stay on adoption, AI proposals, tool access, export, restore and closing; reversible actions (removing a link or a map placement, saving a placement, closing access, dismissing a proposal) take one click. Closing the application asks once more.
- Konuşmalarım uses the same light theme; after an import the first action is "Bu konuşmadan kayıt çıkar"; the copy-or-download mode is the default for continuing elsewhere; step-by-step help for getting an export file; select all; a multi-version conversation opens on its latest version.
- Haritam: searchable record picker, link back to the record, "Yalnız benimsediklerimi göster", hypotheses marked as such, and an export preview in a sandboxed frame before download (the page's policy allows exactly the export stylesheet by hash).
- Accessibility: text contrast at least 4.5:1, borders and focus rings at least 3:1, 13 px minimum text and 16 px inputs, menus wrap at 375 px, reduced-motion respected, no skipped heading levels, long strings wrap.

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

- Remove the "Veri paketi" tool from Konuşmalarım: the `dataset` intent, the `export` operation and the `dataset.jsonl` / manifest / README package. töre no longer has any tool that turns conversations or notes into a dataset.
- Continuing a conversation with another model (the `continue` intent) is unchanged. Drafts saved by older versions with the removed intent still load, are shown as no longer supported and cannot be executed.

## 0.12.1 — Open-source licence and a narrower scope (2026-11-16)

- **Licence.** From this version the original code is offered under the GNU Affero General Public License v3 (AGPL-3.0-only), with a separate commercial licence available. Licence history: `NOTICE.md`.
- Add `COMMERCIAL-LICENSE.md` and `CONTRIBUTING.md`.
- The README describes candidate proposal consistently: töre proposes source-linked candidates and the person confirms each one.

## 0.12.0 — Thinkers and first public source (2026-11-16)

- First version published as a public repository, which receives one commit per release.
- The topic-notebook navigation shows **Düşünürler** on every page.

### Thinkers

- Add a versioned, editorial catalog of eight thinkers (Gökalp, Hegel, Ibn Khaldun, Gellner, Weber, Hobbes, Fichte, Schmitt) with works, ideas, criticisms and stated limits. Public, general information only; no personal views are written into the source.
- Add a **Düşünürler** page (`/dusunurler`) where the person links their own notebook records to a thinker, with an optional note. Linking and unlinking require explicit consent; no affinity score, ranking or identity inference.
- Store links inside the topic notebook (`thinkerLinks`), so they share its lock, atomic write, backups and restore validation. Empty links are not serialized; existing store and backup hashes are unchanged.
- New local operations: `thinkers`, `thinkers-link`, `thinkers-unlink`. No network calls, models or paid services.

## 0.11.0-rc.4 — Licence change (2026-11-15)

- Licence only, no functional change. Licence history: `NOTICE.md`.

## 0.11.0-rc.3 — Topic overview and review queue (2026-11-15)

- Add a global overview and filtered pending-review queue, using the existing source-aware editor.
- Organize previously uncategorized conversation links into local topic groups and source-based subtopics.
- Preserve original conversations, record content, review history, approvals, and saved contexts; keep topic moves in an audited, backed-up operation.
- Add synthetic organization coverage and a local-only migration verification tool. No models or paid services are invoked.

## 0.11.0-rc.2 — Existing archive migration (2026-11-15)

Local bulk topic links and conservative source candidates, preserved legacy endorsements, visible previous opinions and conversation return points. Preview-bound atomic migration, retry protection and backward-compatible backups. No personal data is added to source or public artifacts.

## 0.11.0-rc.1 — Return to a topic (2026-11-15)

Preview preparation: custom topics; source-linked opinion, decision and question candidates; separate review/adoption/currency/priority; preserved revisions and reasons; selected manual context; AI-attributed pasted replies; sidecar backup/restore and explicit legacy migration. The desktop home opens the topic view. Existing imports and opinion tools remain available.

Added synthetic examples, an isolated launcher, English setup/architecture/limitations documentation and fresh verification. Rebuilt compatibility WASM assets with remapped paths. No local-model execution or paid request.

## Earlier versions

0.10 introduced optional cloud/manual ideology workflows and disabled local inference. 0.8–0.9 introduced opinion cards.
