//! Conservative local organization, not model inference or belief attribution.
use super::super::types::Message;
use super::*;
const RULE_VERSION: &str = "local-topics-v2";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationLink {
    pub id: String,
    pub topic_id: String,
    pub conversation_id: String,
    pub title: String,
    pub provider: String,
    pub source_created_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub last_user_source: Option<Source>,
    pub classification_reason: String,
    pub warning: Option<String>,
    pub candidate_ids: Vec<String>,
    pub linked_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtopic_title: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BulkReceipt {
    pub source_hash: String,
    pub linked: usize,
    pub candidates_created: usize,
    pub topics_created: usize,
    pub backup_id: Option<String>,
}
struct Plan {
    topics: BTreeMap<String, Topic>,
    links: Vec<ConversationLink>,
    records: Vec<Record>,
    source_hash: String,
    preview_hash: String,
    warnings: Vec<String>,
}

pub(super) fn folded(s: &str) -> String {
    s.to_lowercase()
        .replace('ı', "i")
        .replace('ö', "o")
        .replace('ü', "u")
        .replace('ş', "s")
        .replace('ğ', "g")
        .replace('ç', "c")
        .replace('\u{307}', "")
}
fn contains_key(text: &str, key: &str) -> bool {
    let key = key.trim();
    text.match_indices(key).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        if before.is_some_and(char::is_alphanumeric) {
            return false;
        }
        let tail = &text[at + key.len()..];
        if ["tore", "izge", "cv", "fal", "altin"].contains(&key) {
            let suffix: String = tail.chars().take_while(|c| c.is_alphanumeric()).collect();
            suffix.is_empty()
                || (["tore", "izge"].contains(&key)
                    && ["yi", "ye", "nin", "de", "den", "miz", "mizin"].contains(&suffix.as_str()))
        } else {
            true
        }
    })
}
#[cfg(test)]
fn classification(title: &str) -> (&'static str, &'static str, String) {
    let result = classify(title, true);
    (result.0, result.1, result.2)
}
fn classify(title: &str, allow_title_only: bool) -> (&'static str, &'static str, String, bool) {
    let t = folded(title);
    let rules: &[(&str, &str, &[&str])] = &[
        ("tore", "Töre", &["tore"]),
        ("izge", "İzge", &["izge"]),
        ("beyin", "Beyin", &["beyin uygulama", "beyin projesi"]),
        (
            "rapor",
            "Rapor arşivi",
            &[
                "rapor uygulama",
                "rapor arsivi",
                "rapor web",
                "raporlar uygulama",
            ],
        ),
        (
            "ideology",
            "Görüşler ve toplum",
            &[
                "ideoloji",
                "kemalizm",
                "cumhuriyet",
                "sosyalizm",
                "kapitalizm",
                "siyaset",
                "felsefem",
                "ideolojim",
                "toplumsal tasarim",
            ],
        ),
        (
            "career",
            "Kariyer ve portföy",
            &[
                "kariyer",
                "portfolio",
                "portfoy",
                "is basvur",
                "career",
                " ozgecmis",
                " cv ",
                "linkedin",
            ],
        ),
        (
            "funding",
            "Fon ve destek araştırmaları",
            &[
                "hibe",
                "fon basvur",
                "funding",
                "fellowship",
                "grant",
                "emergent ventures",
                "futo",
            ],
        ),
        (
            "film",
            "Film ve hikâye",
            &["film", "sinema", "senaryo", "hikaye", "treatment"],
        ),
        (
            "science",
            "Bilim ve araştırma",
            &[
                "fraktal", "noron", "kozmik", "bilim", "fizik", "biyoloji", "arxiv",
            ],
        ),
        (
            "markets",
            "Piyasalar ve yatırım araştırmaları",
            &[
                "yatirim", "altin", "bitcoin", "binance", "backtest", "osint", "finans", "borsa",
                "market",
            ],
        ),
        (
            "anime",
            "Anime ve izleme listesi",
            &["anime", "myanimelist", "manga", "mal list"],
        ),
        (
            "ai_tools",
            "AI araçları ve geliştirme",
            &[
                "openrouter",
                "deepseek",
                "dify",
                "fal ",
                "fal.ai",
                "claude",
                "codex",
                "chatgpt",
                "gemini",
                "mcp",
                "yapay zeka",
                "model",
                "yazilim",
            ],
        ),
    ];
    // General personal subjects and broader vocabulary are title-only. A
    // passing mention inside a user message does not establish the topic.
    let title_rules: &[(&str, &str, &[&str])] = &[
        (
            "health",
            "Sağlık ve yaşam",
            &["saglik", "uyku", "beslenme", "egzersiz", "hastalik"],
        ),
        (
            "languages",
            "Dil ve çeviri",
            &[
                "ceviri",
                "tercume",
                "translation",
                "ingilizce",
                "almanca",
                "sirpca",
                "language learning",
            ],
        ),
        (
            "learning",
            "Öğrenme ve okuma",
            &[
                "ogrenme",
                "egitim",
                "ders",
                "kurs",
                "okuma grubu",
                "kitap onerisi",
                "reading",
                "learning",
            ],
        ),
        (
            "history",
            "Tarih ve kültür",
            &[
                "tarih arastirmasi",
                "tarihi olay",
                "osmanli",
                "antik",
                "mitoloji",
                "history of",
                "kultur",
                "culture",
            ],
        ),
        (
            "planning",
            "Günlük planlama",
            &[
                "gunluk plan",
                "haftalik plan",
                "takvim",
                "hatirlatici",
                "yapilacaklar",
                "seyahat plani",
                "alisveris listesi",
            ],
        ),
        (
            "ideology",
            "Görüşler ve toplum",
            &["felsefe", "etik", "ahlak", "philosophy", "ethics"],
        ),
        (
            "markets",
            "Piyasalar ve yatırım araştırmaları",
            &[
                "trading",
                "crypto",
                "kripto",
                "forex",
                "hisse",
                "stock market",
                "yatirim stratejisi",
            ],
        ),
        (
            "career",
            "Kariyer ve portföy",
            &[
                "meslek",
                "is arama",
                "is ilani",
                "is gorusmesi",
                "isveren",
                "ozgecmis",
                "job application",
                "recruitment",
            ],
        ),
    ];
    let mut hits: Vec<_> = rules
        .iter()
        .chain(title_rules.iter().filter(|_| allow_title_only))
        .filter(|(_, _, keys)| keys.iter().any(|key| contains_key(&t, key)))
        .collect();
    let mut category_ids = BTreeSet::new();
    hits.retain(|(id, _, _)| category_ids.insert(*id));
    // A project name is stronger than its technology/domain. Multiple project
    // names remain unclassified; no semantic claim is invented.
    let projects: Vec<_> = hits
        .iter()
        .filter(|(id, _, _)| ["tore", "izge", "beyin", "rapor"].contains(id))
        .collect();
    if projects.len() == 1 {
        let (id, title, _) = **projects[0];
        return (
            id,
            title,
            "Başlıktaki proje adıyla yerel eşleme; kullanıcı sınıflandırması değildir.".into(),
            false,
        );
    }
    if projects.is_empty() {
        let specific: Vec<_> = hits.iter().filter(|(id, _, _)| *id != "ai_tools").collect();
        if specific.len() == 1 {
            let (id, title, _) = **specific[0];
            return (
                id,
                title,
                "Başlıktaki konu sözcüğüyle yerel eşleme; kesin sınıflandırma değildir.".into(),
                false,
            );
        }
        if specific.is_empty() && hits.len() == 1 {
            let (id, title, _) = *hits[0];
            return (
                id,
                title,
                "Başlıktaki araç adıyla yerel eşleme.".into(),
                false,
            );
        }
    }
    (
        "other",
        "Diğer konuşmalar",
        if hits.len() > 1 {
            "Başlık birden çok konuya eşleşiyor; tek bir konu tahmin edilmedi."
        } else {
            "Başlık tek bir konuya güvenle eşlenmedi; konuşma kaybolmadan burada tutuluyor."
        }
        .into(),
        hits.len() > 1,
    )
}
fn classification_with_source(
    title: &str,
    visible: &[(&Message, String)],
) -> (&'static str, &'static str, String) {
    let (key, topic_title, reason, ambiguous) = classify(title, true);
    let initial = (key, topic_title, reason);
    if ambiguous || !["other", "ai_tools"].contains(&initial.0) {
        return initial;
    }
    let text = visible
        .iter()
        .take(3)
        .chain(visible.iter().rev().take(8))
        .map(|(_, t)| clip(t, 1200))
        .collect::<Vec<_>>()
        .join("\n");
    let candidate = classify(&text, false);
    if candidate.0 != "other" {
        (candidate.0,candidate.1,"Görünür kullanıcı sözlerindeki konu sözcükleriyle yerel eşleme; AI yanıtları kullanılmadı ve kesin sınıflandırma değildir.".into())
    } else {
        initial
    }
}
pub(super) fn visible_text(m: &Message) -> Option<String> {
    if m.role != "user"
        || m.phase.as_deref().is_some_and(|p| {
            [
                "analysis",
                "reasoning",
                "thoughts",
                "summary",
                "justify",
                "confidence",
                "tool",
            ]
            .contains(&p)
        })
    {
        return None;
    }
    let text = m.text.trim();
    if text.is_empty()
        || ["evet", "tamam", "olur", "devam", "tesekkurler", "ok", "yes"]
            .contains(&folded(text).trim_end_matches(['.', '!']).trim())
        || [
            "# AGENTS.md instructions",
            "<environment_context>",
            "<codex_automation_message>",
            "<codex_delegation>",
            "<permissions instructions>",
            "<system_reminder>",
            "<turn_aborted>",
            "<INSTRUCTIONS>",
            "You are Codex",
            "You are ChatGPT",
        ]
        .iter()
        .any(|p| text.starts_with(p))
    {
        return None;
    }
    if let Some(raw) = text
        .strip_prefix("<send_user_message_question_reply>")
        .and_then(|x| x.strip_suffix("</send_user_message_question_reply>"))
    {
        let parsed: Vec<Value> = serde_json::from_str(raw.trim()).ok()?;
        // Preserve an exact substring, never a reserialized/decoded invention.
        return parsed
            .iter()
            .rev()
            .filter_map(|x| x["answer"].as_str())
            .find(|answer| answer.chars().count() >= 4 && m.text.contains(*answer))
            .map(str::to_owned);
    }
    if text.starts_with('<') || text.starts_with("```") {
        return None;
    }
    Some(text.to_owned())
}
pub(super) fn branch(c: &Conversation) -> Result<Vec<&Message>, String> {
    let map: BTreeMap<_, _> = c.messages.iter().map(|m| (&m.id, m)).collect();
    let parents: BTreeSet<_> = c
        .messages
        .iter()
        .filter_map(|m| m.parent_id.as_ref())
        .collect();
    let leaves: Vec<_> = c
        .messages
        .iter()
        .filter(|m| !parents.contains(&m.id))
        .collect();
    let leaf = match &c.selected_leaf_id {
        Some(id) => map
            .get(id)
            .copied()
            .ok_or("Seçili dal bulunamadı; aday çıkarılmadı.")?,
        None if leaves.len() == 1 => leaves[0],
        None => {
            return Err("Konuşma dalı seçilmemiş; dal tahmin edilmedi ve aday çıkarılmadı.".into());
        }
    };
    let mut path = vec![];
    let mut seen = BTreeSet::new();
    let mut current = Some(leaf);
    while let Some(m) = current {
        if !seen.insert(&m.id) {
            return Err("Kaynak dalında döngü var; aday çıkarılmadı.".into());
        }
        path.push(m);
        current = match &m.parent_id {
            Some(id) => Some(
                map.get(id)
                    .copied()
                    .ok_or("Kaynak dalının üst mesajı yok; aday çıkarılmadı.")?,
            ),
            None => None,
        };
    }
    path.reverse();
    Ok(path)
}
pub(super) fn clip(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}
fn source(c: &Conversation, m: &Message, excerpt: String) -> Source {
    Source {
        id: format!("conversation:{}:{}", c.id, m.id),
        kind: "conversation".into(),
        conversation_id: Some(c.id.clone()),
        message_id: Some(m.id.clone()),
        reply_id: None,
        excerpt,
        title: c.title.clone(),
        provider: c.provider.clone(),
        role: "user".into(),
        timestamp: m.timestamp.clone(),
    }
}
fn candidate_kind(text: &str) -> Option<&'static str> {
    let s = folded(text);
    if s.contains('?') && !s.starts_with('>') {
        return Some("question");
    }
    if [
        "karar verdim",
        "kararimiz",
        "tercih ediyorum",
        "devam edecegim",
        "vazgectim",
        "istemiyorum",
    ]
    .iter()
    .any(|p| s.contains(p))
    {
        return Some("decision");
    }
    if ["savunuyorum", "benimsiyorum", "dusunuyorum", "bence "]
        .iter()
        .any(|p| s.contains(p))
    {
        return Some("opinion");
    }
    None
}
impl Disk {
    fn bulk_plan(&self, conversations: &BTreeMap<String, Conversation>) -> Result<Plan, String> {
        self.check()?;
        if conversations.len() > 5000 {
            return Err(
                "Toplu aktarım en fazla 5000 konuşmayı destekliyor; veriler değiştirilmedi.".into(),
            );
        }
        let source_hash = hash(conversations)?;
        let state_hash = hash(&self.data)?;
        let preview_hash = hash(
            &json!({"ruleVersion":RULE_VERSION,"stateHash":state_hash,"sourceHash":source_hash}),
        )?;
        let mut plan=Plan{topics:BTreeMap::new(),links:vec![],records:vec![],source_hash,preview_hash,warnings:vec!["Yerel başlık/ifade kuralları kullanılır; AI analizi değildir. Yeni adayların benimsenmesi ve güncelliği doğrulanmamıştır.".into(),"Eski sorunun yanıtlanıp yanıtlanmadığı otomatik çıkarılmaz; soru adayları inceleme bekler.".into()]};
        let stamp = now();
        for c in conversations.values() {
            if self.data.conversation_links.contains_key(&c.id) {
                continue;
            }
            let (messages, mut warning) = match branch(c) {
                Ok(path) => (path, None),
                Err(w) => (vec![], Some(w)),
            };
            let visible: Vec<_> = messages
                .into_iter()
                .filter_map(|m| visible_text(m).map(|text| (m, text)))
                .collect();
            let (key, title, classification_reason) =
                classification_with_source(&c.title, &visible);
            let tid = format!("bulk-topic-{key}");
            if !self.data.topics.contains_key(&tid) {
                plan.topics.entry(tid.clone()).or_insert_with(||Topic{id:tid.clone(),title:title.into(),goal:"Mevcut konuşmalardan yerel kurallarla düzenlenmiş kaynaklar. Kayıtların durumunu kullanıcı belirler.".into(),created_at:stamp.clone(),creation_request_hash:format!("{RULE_VERSION}:{key}")});
            }
            let last_user_source = visible
                .last()
                .map(|(m, text)| source(c, m, clip(text, 1500)));
            if last_user_source.is_none() && warning.is_none() {
                warning =
                    Some("Görünür kullanıcı sözü bulunamadı; konuşma bağlantısı korundu.".into());
            }
            let mut candidate_ids = vec![];
            let mut seen = BTreeSet::new();
            for (m, text) in visible.iter().rev() {
                // Large pasted documents are sources, not automatically extracted
                // personal claims. Preserve the link rather than guessing authorship.
                if text.chars().count() > 2000 || text.starts_with('>') || text.contains("```") {
                    continue;
                }
                for segment in text
                    .split_inclusive(['\n', '.', '?', '!'])
                    .map(str::trim)
                    .rev()
                {
                    if segment.chars().count() < 12
                        || segment.chars().count() > 700
                        || segment.starts_with(['>', '#', '<', '{', '['])
                    {
                        continue;
                    }
                    let Some(kind) = candidate_kind(segment) else {
                        continue;
                    };
                    if !seen.insert(kind) {
                        continue;
                    }
                    let rid = format!(
                        "bulk-record-{}",
                        digest(format!("{}\n{}\n{}\n{}", c.id, m.id, kind, segment).as_bytes())
                    );
                    if self.data.records.contains_key(&rid) {
                        candidate_ids.push(rid);
                        continue;
                    }
                    if let Some(existing) = self.data.records.values().find(|r| {
                        r.topic_id == tid
                            && r.kind == kind
                            && r.source.as_ref().is_some_and(|s| {
                                s.conversation_id.as_ref() == Some(&c.id)
                                    && s.message_id.as_ref() == Some(&m.id)
                                    && s.excerpt == segment
                            })
                    }) {
                        candidate_ids.push(existing.id.clone());
                        continue;
                    }
                    let record=Record{id:rid.clone(),topic_id:tid.clone(),kind:kind.into(),text:segment.into(),reason:if kind=="question"{"Kaynakta soru biçimi bulundu. Hâlâ açık olup olmadığı ve önceliği doğrulanmadı; yerel aktarım adayıdır."}else{"Kaynakta görüş/karar belirten ifade bulundu. Güncel olarak benimsendiği doğrulanmadı; yerel aktarım adayıdır."}.into(),source:Some(source(c,m,segment.into())),attribution:"user_statement".into(),review:"pending".into(),adoption:if kind=="question"{"not_applicable"}else{"unknown"}.into(),currency:"unknown".into(),priority:"unspecified".into(),question_state:if kind=="question"{"open"}else{"not_applicable"}.into(),answers_question_id:None,revision:1,created_at:stamp.clone(),updated_at:stamp.clone(),history:vec![],legacy:None,creation_request_hash:format!("{RULE_VERSION}:{rid}"),trashed_at:None};
                    validate_record(&record)?;
                    candidate_ids.push(rid);
                    plan.records.push(record);
                    if seen.len() >= 3 {
                        break;
                    }
                }
                if seen.len() >= 3 {
                    break;
                }
            }
            plan.links.push(ConversationLink {
                id: format!("conversation-link:{}", c.id),
                topic_id: tid,
                conversation_id: c.id.clone(),
                title: c.title.clone(),
                provider: c.provider.clone(),
                source_created_at: c.created_at.clone(),
                source_updated_at: c.updated_at.clone(),
                last_user_source,
                classification_reason,
                warning,
                candidate_ids,
                linked_at: stamp.clone(),
                subtopic_title: None,
            });
        }
        if self.data.records.len() + plan.records.len() > 3000
            || self.data.topics.len() + plan.topics.len() > 200
        {
            return Err(
                "Toplu plan konu/kayıt kapasitesini aşıyor; kısmi aktarım yapılmadı.".into(),
            );
        }
        Ok(plan)
    }
    pub fn bulk_preview(
        &self,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Value, String> {
        let plan = self.bulk_plan(conversations)?;
        let mut topics: BTreeMap<String, Value> = BTreeMap::new();
        for link in self.data.conversation_links.values().chain(&plan.links) {
            let title = self
                .data
                .topics
                .get(&link.topic_id)
                .or_else(|| plan.topics.get(&link.topic_id))
                .ok_or("Konu bulunamadı")?
                .title
                .clone();
            let row=topics.entry(link.topic_id.clone()).or_insert_with(||json!({"id":link.topic_id,"title":title,"conversationCount":0,"newLinkCount":0,"candidateCount":0}));
            row["conversationCount"] = json!(row["conversationCount"].as_u64().unwrap_or(0) + 1);
        }
        for link in &plan.links {
            let row = topics
                .get_mut(&link.topic_id)
                .ok_or("Plan konusu bulunamadı")?;
            row["newLinkCount"] = json!(row["newLinkCount"].as_u64().unwrap_or(0) + 1);
            row["candidateCount"] = json!(
                row["candidateCount"].as_u64().unwrap_or(0) + link.candidate_ids.len() as u64
            );
        }
        Ok(
            json!({"previewHash":plan.preview_hash,"stateHash":hash(&self.data)?,"sourceHash":plan.source_hash,"ruleVersion":RULE_VERSION,"conversationCount":conversations.len(),"linkedCount":plan.links.len(),"candidateCount":plan.records.len(),"alreadyLinked":self.data.conversation_links.len(),"topics":topics.values().collect::<Vec<_>>(),"warnings":plan.warnings}),
        )
    }
    pub fn bulk_apply(
        &mut self,
        input: Value,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Apply {
            preview_hash: String,
            confirmed_by_user: bool,
        }
        self.check()?;
        let r: Apply = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Toplu aktarım açık kullanıcı onayı gerektirir.".into());
        }
        if let Some(receipt) = self.data.bulk_receipts.get(&r.preview_hash) {
            if receipt.source_hash != hash(conversations)? {
                return Err("Kaynak konuşmalar değişti; önizlemeyi yenileyin.".into());
            }
            return Ok(
                json!({"linked":receipt.linked,"candidatesCreated":receipt.candidates_created,"topicsCreated":receipt.topics_created,"backupId":receipt.backup_id,"stateHash":hash(&self.data)?,"alreadyApplied":true}),
            );
        }
        let plan = self.bulk_plan(conversations)?;
        if r.preview_hash != plan.preview_hash {
            return Err("Konuşmalar veya konu defteri değişti; önizlemeyi yenileyin.".into());
        }
        if plan.links.is_empty() {
            return Ok(
                json!({"linked":0,"candidatesCreated":0,"topicsCreated":0,"backupId":null,"stateHash":hash(&self.data)?,"alreadyApplied":true}),
            );
        }
        let mut next = self.data.clone();
        let receipt = BulkReceipt {
            source_hash: plan.source_hash,
            linked: plan.links.len(),
            candidates_created: plan.records.len(),
            topics_created: plan.topics.len(),
            backup_id: None,
        };
        next.topics.extend(plan.topics);
        next.records
            .extend(plan.records.into_iter().map(|r| (r.id.clone(), r)));
        next.conversation_links.extend(
            plan.links
                .into_iter()
                .map(|l| (l.conversation_id.clone(), l)),
        );
        validate_store(&next)?;
        persistence::validate_sources(&next, conversations)?;
        let backup = self.backup()?;
        let receipt = BulkReceipt {
            backup_id: backup["backupId"].as_str().map(str::to_owned),
            ..receipt
        };
        next.bulk_receipts
            .insert(plan.preview_hash, receipt.clone());
        self.commit(next)?;
        Ok(
            json!({"linked":receipt.linked,"candidatesCreated":receipt.candidates_created,"topicsCreated":receipt.topics_created,"backupId":receipt.backup_id,"stateHash":hash(&self.data)?,"alreadyApplied":false}),
        )
    }
}

#[cfg(test)]
#[path = "records_bulk_tests.rs"]
mod tests;
