# töre 0.16.0 — A new design, English and Turkish

Released 2026-11-18.

## What changed

- **New look.** An off-white ground, ink text, a cobalt accent, turquoise for the AI's voice and coral for objections; serif headings over a sans interface and softer corners. Source quotes, your own words and AI proposals each have their own visual voice. The wordmark is "töre", without a trailing full stop. No web fonts are loaded; system faces are used.
- **Four-item menu.** Topics · Waiting for you · My map · Conversations on every page. Thinkers sits under My map and Archive under Conversations; page addresses are unchanged and the old review address `/konular?view=review` still works.
- **Topic desk.** A selected topic opens in three panes: the topic rail on the left, the topic in the centre with a "Where I left off" line and the tabs Now, All records and Map, and a Source pane on the right with the clicked record's exact excerpt, conversation title and date. The panes stack on narrow screens. Each record shows one status line instead of a row of chips.
- **Waiting for you.** The review queue and the connected-tool inbox are one list. Pending records are grouped by origin and shown with their source excerpt; tool proposals are grouped by tool and day. There is no accept-all: each item is decided on its own, and adopting needs the same confirmation as the editor.
- **First run and import receipt.** A notebook with no topics shows three steps (where the notebook lives, importing, a first topic). After an import, a receipt lists what was read, what was skipped and why, and how many records wait.
- **English and Turkish.** The interface of Topics, Waiting for you, Conversations, My map, Thinkers, the Archive and the old opinion notebook is available in both languages. English is the default; a browser set to Turkish starts in Turkish. The EN | TR switch in every top bar redraws the page in place. The choice is kept beside the notebook in `ui-language.json` through the new private operations `ui-language-get` and `ui-language-set`.
- **Still Turkish only:** server-generated content (the thinker catalogue, bulk-placement warnings and reasons, ideology captions), rarer server errors, the archive's starter thinker templates, legacy development pages, and the launcher's and command-line messages.
- **Fix.** The record picker on Thinkers and My map no longer stretches its radio buttons across the row.

## Stored data

The record notebook format is unchanged. The only new file is `ui-language.json` beside the notebook. It holds `"en"` or `"tr"`, is not part of record backups, and restoring a backup leaves it as it is. A missing or damaged file falls back to the browser's language.

## Licence

Unchanged: AGPL-3.0-only, with a separate commercial licence available from the owner.

## Checks run on the release tree

| Command | Result |
|---|---|
| `bash scripts/build.sh` | passed |
| `cargo test --locked --manifest-path core/Cargo.toml` | 16 passed, 0 failed |
| `cargo test --locked --manifest-path server/Cargo.toml` | 169 passed, 0 failed, 1 ignored optional network probe |
| `node --test local-reader/tests/*.test.cjs` | 251 passed, 0 failed |
| Screenshots in `docs/images` | taken at 1440 pixels in English against a synthetic notebook |

These results establish only the behaviours the tests exercise. No model was invoked and no paid request was made.
