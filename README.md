<h1 align="center">töre</h1>

<p align="center"><strong>Pick up your thinking where you left off.</strong></p>

<p align="center">
  A local notebook that keeps the ideas, decisions and open questions from your AI conversations<br>
  connected to their sources, so you can return to a topic and continue with the right context.
</p>

<p align="center">
  <a href="https://ondersamet97.github.io/tore-site/">Website</a> ·
  <a href="https://ondersamet97.github.io/tore-site/tr/">Türkçe</a> ·
  <a href="docs/PREVIEW-DEMO.md">Three-minute demo</a> ·
  <a href="ABOUT.md">About me</a> ·
  <a href="CHANGELOG.md">Change log</a> ·
  <a href="https://www.linkedin.com/company/tore-app/">LinkedIn</a>
</p>

<p align="center">
  <img alt="Version 0.13.0" src="https://img.shields.io/badge/version-0.13.0-2b4eff">
  <img alt="Status: preview" src="https://img.shields.io/badge/status-preview-0f1115">
  <img alt="Licence: AGPL-3.0" src="https://img.shields.io/badge/licence-AGPL--3.0-0f1115">
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-0f1115">
  <img alt="Runs locally" src="https://img.shields.io/badge/runs-locally-0f1115">
</p>

<p align="center">
  <img src="docs/images/topic.png" alt="A töre topic showing an adopted decision with its reason and an open question, both linked to their source conversation" width="860">
</p>

> **Preview, not a finished product.** The interface is Turkish for now, it has been tested on macOS only, and there is no installer: you build it from source. Every screenshot here uses a synthetic example, not anyone's real notes.

## The question

Long conversations with AI tools produce decisions, reasons and open questions, and then they scroll away. Weeks later it is hard to say what you decided, why, what changed and what is still open.

töre is built around one question: **where did I leave off?**

## How it works

| | |
|---|---|
| **1. Bring your conversations** | Import conversations you already have from ChatGPT, Claude or Codex into a workspace on your own computer. |
| **2. Review what matters** | töre proposes source-linked candidates from your history: decisions, opinions and open questions. Nothing counts until you confirm it; you decide what to adopt, what to revise and what stays open. You can also pick a quote yourself. |
| **3. Continue with context** | When you return to a topic, choose the reviewed context to carry forward and paste it into the AI tool of your choice. Nothing goes anywhere unless you send it. |

<p align="center">
  <img src="docs/images/record.png" alt="A decision opened next to the original quote it came from, with separate review, adoption and currency states" width="760">
</p>

## What is in 0.13.0

### Topics: return to unfinished thinking

- Custom topics with a **Kaldığım yer** ("where I left off") view: current decisions, opinions, open questions and what still awaits review.
- Review, adoption, currency and work priority are separate states. An open question cannot silently become an adopted belief; closing it takes an explicit action and a reason.
- Every revision keeps its previous wording and the reason for the change.
- A global overview and a review queue across all topics.

### Map of my thinking: let a reader see where you stand *(new)*

A reader-facing page (**Haritam**, `/harita`) that arranges records you already have into nine sections, from starting points to how a person and a society should live. Each record takes a role: premise, position, divergence, change of view, objection, answer, what would refute it, or open question.

- **Test a view.** Under any position you can write an objection, your answer to it and the evidence that would change your mind. The page shows, per position, how many objections it has, how many are answered and whether a refutation criterion is stated.
- **Nothing is inferred.** The map only places records. Each one keeps its own source quote, review and adoption state, and a record awaiting review is shown as such, never as your view. A placement proposed by an assistant is marked until you confirm it.
- **Turkish and English.** A translation is stored next to the entry and labelled as an AI translation or as your own; the original wording always stays visible.
- **One file to hand over.** With explicit consent töre writes a single script-free HTML file to your computer. By default it contains only records you reviewed and did not reject; conversation titles and identifiers are left out. töre sends it nowhere.

### Connected AI tool (MCP) *(new)*

`tore-server mcp --data <folder>` lets Claude Desktop or Claude Code read exactly the continuation contexts you opened, read-only, with no copy and paste. See [docs/MCP.md](docs/MCP.md).

### Thinkers: place your notes next to the thinkers you read

An editorial catalogue of eight thinkers (Gökalp, Hegel, Ibn Khaldun, Gellner, Weber, Hobbes, Fichte, Schmitt) with their works, ideas, criticisms and stated limits. You link your own records to a thinker yourself, with an optional note.

töre does not score your affinity, rank you or infer an identity. Linking and unlinking both need your explicit confirmation.

<p align="center">
  <img src="docs/images/thinkers.png" alt="The thinkers page with one thinker opened and a notebook record linked to it by the user" width="760">
</p>

### Connected AI tool: no copy-paste *(unreleased)*

Instead of copying a prepared context, you can open that one text to an AI tool on the same computer that speaks the Model Context Protocol, such as Claude Desktop or Claude Code. Opening it takes its own confirmation, the page shows **Bağlı AI aracına açık** while it is open, and one click closes it again. The tool can read only the contexts you opened, never your records, conversations or anything else, and it cannot write to töre. See [docs/MCP.md](docs/MCP.md).

## Principles

- **Three voices stay distinct.** The original quote, your own words and the AI's interpretation are kept apart and labelled.
- **Nothing becomes your view silently.** Silence is not consent. An AI suggestion starts unadopted and stays labelled as AI material.
- **Local by default.** The server binds to loopback on your own computer. Organising topics and linking thinkers call no language model and no paid service.
- **It does not compete for your attention.** No notifications, no streaks, no infinite feed.

## Quick start

Requirements: Rust with edition 2024 support, Python 3 and Node.js 22.12 or newer (Node 26 or newer for the full test suite). The launchers are for macOS; other platforms have not been verified. Installing dependencies uses the network; it does not upload application data.

```sh
cd local-reader
npm ci --ignore-scripts
cd ..
bash scripts/build.sh
bash Preview.command
```

`Preview.command` opens an isolated store in `.preview-data`, so you can try töre without touching any other data. Import `fixtures/return-topic.json` under **Konuşmalarım** and follow [the three-minute demo](docs/PREVIEW-DEMO.md).

`Başlat.command` is the everyday launcher. It keeps your data in `.demo-data` inside the checkout; despite the name, treat that folder as your real notebook and back it up.

The launcher opens a loopback URL that carries a local access token. Keep that URL private. Closing the browser tab does not stop the server; use the application's shutdown control or Ctrl-C in its terminal.

Run the tests:

```sh
cargo test --locked --manifest-path core/Cargo.toml
cargo test --locked --manifest-path server/Cargo.toml
node --test local-reader/tests/*.test.cjs
```

## Data and privacy

- Private operations are protected by a session token and Host/Origin checks.
- Copying context to the clipboard is a separate, deliberate action. The destination service receives the text only if you paste and send it there; clipboard history and the destination's retention are outside töre's control.
- Optional connections to AI services exist but are experimental and are not needed for anything described above.
- töre has no tool that packages your conversations or notes as a dataset for research or model training.
- This repository contains source code and synthetic fixtures only. It contains no personal notebook, conversation or credential.

## Limitations

töre is a single-user preview. There is no multi-user isolation, cloud sync, hosted service or availability guarantee. Records are statements you reviewed, not verified truths. See [known limitations](docs/PREVIEW-LIMITATIONS.md).

## Documentation

| | |
|---|---|
| [Architecture and data flow](docs/PREVIEW-ARCHITECTURE.md) | How the local server, stores and pages fit together |
| [Record and API contract](docs/RECORDS-CONTRACT.md) | Record states, operations and storage rules |
| [Connected AI tool (MCP)](docs/MCP.md) | Opening one prepared context to Claude Desktop or Claude Code, read-only |
| [Demo script](docs/PREVIEW-DEMO.md) | A synthetic walk-through in two to three minutes |
| [Known limitations](docs/PREVIEW-LIMITATIONS.md) | What this preview does not do |
| [0.13.0 release note](docs/RELEASE-0.13.0.md) | What changed and how it was checked |
| [Third-party notices](docs/THIRD-PARTY-NOTICES.md) | Licences of bundled and linked components |

## Releases

This repository is updated release by release, starting with 0.12.0. Day-to-day development happens in a private working repository, and earlier versions were not published.

## Licence

**Open source, with a commercial option.** töre is free software under the [GNU Affero General Public License v3](LICENSE) (AGPL-3.0-only). You may use, study, modify and share it; if you distribute it or run a modified version as a network service, you must offer your source under the same licence.

If those terms do not work for you, for example because you want to build töre into a closed product, a separate [commercial licence](COMMERCIAL-LICENSE.md) is available from the owner.

Third-party code keeps its own licences in `licenses/`, `vendor/` and `local-reader/vendor/`. Your conversations and notes are yours and are not covered by the software licence. Copyright notice and licence history: [NOTICE.md](NOTICE.md).

## About me

töre is an independent project by Önder Samet. Before töre I worked on AI training data and evaluation at Yandex, as AI Editor and then AI Lead Editor, and in video production, including part-time at the Human Resources Office of the Presidency of the Republic of Türkiye. Who I am, why I am building töre and what I hold to are in **[About me](ABOUT.md)**.

Contact: <onders97@hotmail.com> · [töre on LinkedIn](https://www.linkedin.com/company/tore-app/)
