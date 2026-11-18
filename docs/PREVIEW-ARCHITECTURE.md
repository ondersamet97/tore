# Preview architecture and data flow

The existing Rust/Axum desktop server embeds the existing JavaScript reader and workspace plus the new topic UI. `/` and `/konular` open the topic UI, `/calisma` opens conversation imports, `/gorusler` retains legacy opinion cards, and `/arsiv` retains the report reader. No new server or service is introduced.

```text
Local import -> conversation store (source IDs, roles and text)
                     |
             explicit quote selection
                     v
              record candidate -> user review -> topic current state
                     |                |                 |
                provenance         revisions       selected context
                                                        |
                                             destination + full preview
                                                        |
                                               user copies/pastes
                                                        |
                                           pasted AI commentary (unadopted)
                                                        |
                                            selected excerpt -> candidate
```

`records-v1.json` is a separate, versioned store beside the conversation and legacy opinion stores. It records topics, records, revisions and manual continuations. Its process lock and atomic file replacement prevent partial writes and concurrent ownership. Source timestamps remain separate from recording/review timestamps. A later import date does not make a statement the current decision.

All private API operations share the existing token, Host and Origin checks. Browser assets use the existing restrictive content security policy. Topic endpoints are local operations; they do not call provider APIs. The new UI requires an explicit destination and copy consent for manual continuation. Existing model integrations use their own preview/send boundary; they are not invoked by this new flow.

Migration is explicit and idempotent. It reads legacy cards, preserves original attribution and endorsement, and creates records without changing the original opinion file. Currency and priority are not inferred from legacy confirmation. A backup/restore rehearsal precedes applying migration; original data stays available. Restoring a backup changes the record store only, not source conversations or the report archive. See the schema contract for validation and backup scope.

The preview source archive is an allowlisted snapshot without `.git`, user stores, real-data reports or credentials. WASM compatibility assets are rebuilt using `scripts/build-core.sh`; Rust and Cargo paths are remapped. Rebuilding the assets requires `wasm32-unknown-unknown` and `wasm-bindgen-cli` 0.2.105. Normal source installation uses the included, scanned assets.
