# Change log

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
