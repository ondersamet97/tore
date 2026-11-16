//! Map of the person's thinking: a reader-facing arrangement of notebook
//! records into starting points, positions, divergences, objections, answers
//! and falsification criteria. An entry only places an existing record; the
//! record keeps its own source, review and adoption state. Nothing here
//! infers a view, scores a person or calls a model.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Translation {
    pub text: String,
    /// `ai` or `user`. An AI translation is always shown as such.
    pub by: String,
    /// Translation of the entry's short heading, by the same translator.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapEntry {
    pub id: String,
    pub record_id: String,
    pub section: String,
    pub role: String,
    pub parent_id: Option<String>,
    pub counterpart: String,
    pub label: String,
    pub note: String,
    pub order: u32,
    /// `user` when the person chose this place; `suggested` when an assistant
    /// proposed it and the person has not confirmed the placement yet.
    pub placement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation_en: Option<Translation>,
    pub created_at: String,
    pub updated_at: String,
    pub creation_request_hash: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddInput {
    #[serde(default, skip_serializing)]
    request_id: Option<String>,
    record_id: String,
    section: String,
    role: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    counterpart: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    note: String,
    #[serde(default)]
    order: u32,
    #[serde(default = "user_placement")]
    placement: String,
    #[serde(default)]
    translation_en: Option<Translation>,
    confirmed_by_user: bool,
}
fn user_placement() -> String {
    "user".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateInput {
    entry_id: String,
    section: String,
    role: String,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    counterpart: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    note: String,
    #[serde(default)]
    order: u32,
    #[serde(default)]
    translation_en: Option<Translation>,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveInput {
    entry_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportInput {
    language: String,
    #[serde(default)]
    include_pending: bool,
    #[serde(default)]
    include_suggested: bool,
    #[serde(default)]
    title: String,
    confirmed_by_user: bool,
}

const MAX_ENTRIES: usize = 3000;
const ROLES: [&str; 8] = [
    "premise",
    "position",
    "divergence",
    "change",
    "objection",
    "answer",
    "test",
    "open_question",
];

/// Fixed, versioned and editorial: the questions a reader asks, not a scale.
pub fn catalog() -> Value {
    json!({
        "version":1,
        "method":"Harita yalnız defterindeki kayıtları yerleştirir. Bir kaydı haritaya koymak onu benimsediğin anlamına gelmez; her kayıt kendi kaynağını, inceleme ve benimseme durumunu taşır. töre görüş çıkarmaz, puan vermez, siyasi kimlik atamaz.",
        "methodEn":"The map only arranges records from the notebook. Placing a record does not mean it is adopted; each record keeps its own source, review and adoption state. töre does not infer views, score a person or assign a political identity.",
        "sections":[
            {"id":"baslangic","title":"Başlangıç noktaları","titleEn":"Starting points","question":"Nereden başlıyorum, neyi baştan kabul ediyorum?","questionEn":"Where do I start, and what do I take as given?"},
            {"id":"insan","title":"İnsan nasıl yaşamalı","titleEn":"How a person should live","question":"Birey, etik, dikkat, emek ve anlam.","questionEn":"The individual, ethics, attention, work and meaning."},
            {"id":"toplum","title":"Toplum nasıl yaşamalı","titleEn":"How a society should live","question":"Siyaset, devlet, millet, hiyerarşi ve adalet.","questionEn":"Politics, the state, the nation, hierarchy and justice."},
            {"id":"bilgi","title":"Bilgi ve yöntem","titleEn":"Knowledge and method","question":"Neyi nasıl bilirim, fikrimi ne değiştirir?","questionEn":"How do I know, and what would change my mind?"},
            {"id":"tarih","title":"Tarih ve medeniyet","titleEn":"History and civilisation","question":"Tarih nasıl işler, nereye gider?","questionEn":"How does history work, and where does it go?"},
            {"id":"teknoloji","title":"Teknoloji ve yapay zekâ","titleEn":"Technology and AI","question":"Araçlar insanı ve toplumu nasıl değiştirir?","questionEn":"How do tools change people and societies?"},
            {"id":"inanc","title":"İnanç ve anlam","titleEn":"Belief and meaning","question":"Din, ölüm ve metafizik.","questionEn":"Religion, death and metaphysics."},
            {"id":"ekonomi","title":"Ekonomi ve emek","titleEn":"Economy and work","question":"Para, mülkiyet, sınıf ve emek.","questionEn":"Money, property, class and work."},
            {"id":"sanat","title":"Sanat ve hikâye","titleEn":"Art and story","question":"Anlatı, kültür ve estetik.","questionEn":"Narrative, culture and aesthetics."}
        ],
        "roles":[
            {"id":"premise","title":"Ön kabul","titleEn":"Premise"},
            {"id":"position","title":"Pozisyon","titleEn":"Position"},
            {"id":"divergence","title":"Ayrılık","titleEn":"Divergence"},
            {"id":"change","title":"Fikir değişimi","titleEn":"Change of view"},
            {"id":"objection","title":"İtiraz","titleEn":"Objection"},
            {"id":"answer","title":"Cevap","titleEn":"Answer"},
            {"id":"test","title":"Yanlışlama ölçütü","titleEn":"What would refute it"},
            {"id":"open_question","title":"Açık soru","titleEn":"Open question"}
        ]
    })
}

fn sections() -> Vec<String> {
    catalog()["sections"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|s| s["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn valid_translation(t: &Option<Translation>) -> bool {
    t.as_ref()
        .is_none_or(|t| {
            bounded(&t.text, 12000, true)
                && bounded(&t.label, 300, false)
                && ["ai", "user"].contains(&t.by.as_str())
        })
}

/// Shape rules shared by writes and by store validation, so a restored or
/// hand-edited store cannot hold a map the application would never create.
fn check_entry(s: &Store, e: &MapEntry) -> Result<(), String> {
    let record = s
        .records
        .get(&e.record_id)
        .ok_or("Haritadaki kayıt bulunamadı")?;
    if !sections().contains(&e.section)
        || !ROLES.contains(&e.role.as_str())
        || !["user", "suggested"].contains(&e.placement.as_str())
        || !bounded(&e.counterpart, 300, false)
        || !bounded(&e.label, 300, false)
        || !bounded(&e.note, 2000, false)
        || !valid_translation(&e.translation_en)
    {
        return Err("Harita girdisi geçersiz".into());
    }
    if (e.role == "open_question") != (record.kind == "question") {
        return Err("Açık soru rolü yalnız soru kaydıyla kullanılır".into());
    }
    match &e.parent_id {
        None if e.role == "objection" => Err("İtiraz bir pozisyona bağlanmalı".into()),
        None => Ok(()),
        Some(parent_id) => {
            let parent = s
                .map_entries
                .get(parent_id)
                .ok_or("Bağlanılan harita girdisi bulunamadı")?;
            let allowed: &[&str] = match e.role.as_str() {
                "objection" | "test" | "divergence" | "change" | "open_question" => {
                    &["premise", "position", "divergence", "change"]
                }
                "answer" => &["objection", "premise", "position", "divergence", "change"],
                _ => &[],
            };
            if parent.id == e.id || !allowed.contains(&parent.role.as_str()) {
                return Err("Bu rol bu girdiye bağlanamaz".into());
            }
            Ok(())
        }
    }
}

pub(super) fn validate_entries(s: &Store) -> Result<(), String> {
    if s.map_entries.len() > MAX_ENTRIES {
        return Err("Harita girdisi sınırı aşıldı".into());
    }
    let mut records = BTreeSet::new();
    for (id, e) in &s.map_entries {
        if id != &e.id || !records.insert(e.record_id.clone()) {
            return Err("Harita girdisi geçersiz veya yinelenmiş".into());
        }
        check_entry(s, e)?;
    }
    // Parents are premise/position-like and children are not, except for
    // divergence and change under one another; walk up to rule out a cycle.
    for e in s.map_entries.values() {
        let (mut cur, mut steps) = (e.parent_id.as_ref(), 0);
        while let Some(pid) = cur {
            steps += 1;
            if steps > 8 {
                return Err("Harita bağlantıları döngü içeriyor".into());
            }
            cur = s.map_entries.get(pid).and_then(|p| p.parent_id.as_ref());
        }
    }
    Ok(())
}

fn role_rank(role: &str) -> usize {
    ROLES.iter().position(|r| *r == role).unwrap_or(ROLES.len())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

struct Words {
    en: bool,
}
impl Words {
    fn pick<'a>(&self, tr: &'a str, en: &'a str) -> &'a str {
        if self.en { en } else { tr }
    }
    fn attribution(&self, a: &str) -> &'static str {
        match (a, self.en) {
            ("user_statement", false) => "Kendi sözü, birebir",
            ("user_statement", true) => "Own words, verbatim",
            ("user_interpretation", false) => "Kendi sözünden, düzenlenmiş",
            ("user_interpretation", true) => "From own words, edited",
            ("user_authored", false) => "Kendi notu",
            ("user_authored", true) => "Own note",
            (_, false) => "AI önerisi",
            (_, true) => "AI proposal",
        }
    }
    fn state(&self, r: &Record) -> String {
        let review = match (r.review.as_str(), self.en) {
            ("reviewed", false) => "incelendi",
            ("reviewed", true) => "reviewed",
            ("rejected", false) => "reddedildi",
            ("rejected", true) => "rejected",
            (_, false) => "inceleme bekliyor",
            (_, true) => "awaiting review",
        };
        let adoption = match (r.adoption.as_str(), self.en) {
            ("adopted", false) => "benimsendi",
            ("adopted", true) => "adopted",
            ("hypothesis", false) => "hipotez",
            ("hypothesis", true) => "hypothesis",
            ("uncertain", false) => "emin değil",
            ("uncertain", true) => "uncertain",
            ("not_adopted", false) => "benimsenmedi",
            ("not_adopted", true) => "not adopted",
            ("not_applicable", false) if r.question_state == "closed" => "kapandı",
            ("not_applicable", true) if r.question_state == "closed" => "closed",
            ("not_applicable", false) => "açık",
            ("not_applicable", true) => "open",
            (_, false) => "benimseme belirtilmedi",
            (_, true) => "adoption not stated",
        };
        format!("{review} · {adoption}")
    }
}

const EXPORT_CSS: &str = "body{font:17px/1.6 Georgia,serif;color:#0f1115;background:#f6f6f3;max-width:46rem;margin:0 auto;padding:2rem 1.2rem 4rem}h1{font-size:2.1rem;margin:0 0 .3rem}h2{margin:3rem 0 .2rem;border-top:2px solid #0f1115;padding-top:1rem}h3{font-size:1.05rem;margin:0 0 .3rem}.q{color:#555;margin:0 0 1.2rem}.e{margin:1.2rem 0;padding:.2rem 0 .2rem 1rem;border-left:3px solid #2b4eff}.e .e{border-left-color:#b9bcc6;margin:.8rem 0}.role{font:600 .72rem/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#2b4eff}.meta,.note,.tr{font:.82rem/1.5 system-ui,sans-serif;color:#555;margin:.3rem 0}.text{margin:.2rem 0;white-space:pre-wrap}.orig{color:#555;font-size:.92rem;white-space:pre-wrap}.notice{font:.85rem/1.5 system-ui,sans-serif;background:#fff;border:1px solid #d9dbe2;padding:.8rem 1rem;margin:1rem 0}.sug{color:#8a5a00}";

impl Disk {
    fn map_item(&self, e: &MapEntry) -> Value {
        let r = &self.data.records[&e.record_id];
        let thinkers: Vec<&String> = self
            .data
            .thinker_links
            .values()
            .filter(|l| l.record_id == r.id)
            .map(|l| &l.thinker_id)
            .collect();
        json!({"entry":e,"thinkerIds":thinkers,"record":{"id":r.id,"topicId":r.topic_id,"kind":r.kind,"text":r.text,
            "reason":r.reason,"attribution":r.attribution,"review":r.review,"adoption":r.adoption,
            "currency":r.currency,"priority":r.priority,"questionState":r.question_state,"revision":r.revision,
            "updatedAt":r.updated_at,"source":r.source}})
    }

    pub fn map_view(&self) -> Result<Value, String> {
        self.check()?;
        let entries: Vec<Value> = self
            .data
            .map_entries
            .values()
            .map(|e| self.map_item(e))
            .collect();
        Ok(json!({"catalog":catalog(),"entries":entries,"stateHash":hash(&self.data)?}))
    }

    pub fn map_add(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: AddInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Haritaya yalnız açık onayla eklenir".into());
        }
        let id = request_id(r.request_id.as_deref())?;
        let request_hash = hash(&r)?;
        if let Some(existing) = self.data.map_entries.get(&id) {
            if existing.creation_request_hash != request_hash {
                return Err("İstek kimliği başka içerik için kullanılmış".into());
            }
            return Ok(json!({"entry":existing}));
        }
        if self
            .data
            .map_entries
            .values()
            .any(|e| e.record_id == r.record_id)
        {
            return Err("Bu kayıt haritada zaten var".into());
        }
        let time = now();
        let entry = MapEntry {
            id,
            record_id: r.record_id,
            section: r.section,
            role: r.role,
            parent_id: r.parent_id,
            counterpart: r.counterpart,
            label: r.label,
            note: r.note,
            order: r.order,
            placement: r.placement,
            translation_en: r.translation_en,
            created_at: time.clone(),
            updated_at: time,
            creation_request_hash: request_hash,
        };
        check_entry(&self.data, &entry)?;
        let mut next = self.data.clone();
        next.map_entries.insert(entry.id.clone(), entry.clone());
        self.commit(next)?;
        Ok(json!({"entry":entry}))
    }

    /// Editing an entry is the person's own act, so a suggested placement
    /// becomes theirs. The record itself is never changed here.
    pub fn map_update(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: UpdateInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Harita yalnız açık onayla değişir".into());
        }
        let mut entry = self
            .data
            .map_entries
            .get(&r.entry_id)
            .cloned()
            .ok_or("Harita girdisi bulunamadı")?;
        entry.section = r.section;
        entry.role = r.role;
        entry.parent_id = r.parent_id;
        entry.counterpart = r.counterpart;
        entry.label = r.label;
        entry.note = r.note;
        entry.order = r.order;
        entry.translation_en = r.translation_en;
        entry.placement = "user".into();
        entry.updated_at = now();
        let mut next = self.data.clone();
        next.map_entries.insert(entry.id.clone(), entry.clone());
        check_entry(&next, &entry)?;
        self.commit(next)?;
        Ok(json!({"entry":entry}))
    }

    pub fn map_remove(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: RemoveInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Haritadan yalnız açık onayla çıkarılır".into());
        }
        if !self.data.map_entries.contains_key(&r.entry_id) {
            return Err("Harita girdisi bulunamadı".into());
        }
        if self
            .data
            .map_entries
            .values()
            .any(|e| e.parent_id.as_ref() == Some(&r.entry_id))
        {
            return Err("Önce bu girdiye bağlı itiraz, cevap ve ölçütleri çıkarın".into());
        }
        let mut next = self.data.clone();
        next.map_entries.remove(&r.entry_id);
        self.commit(next)?;
        Ok(json!({"removed":r.entry_id}))
    }

    fn exportable(e: &MapEntry, r: &Record, pending: bool, suggested: bool) -> bool {
        if r.review == "rejected" || (!suggested && e.placement == "suggested") {
            return false;
        }
        if pending {
            return true;
        }
        r.review == "reviewed"
            && r.currency != "superseded"
            && (e.role == "objection" || e.role == "change" || r.adoption != "not_adopted")
    }

    fn export_entry(&self, e: &MapEntry, kept: &[&MapEntry], w: &Words, out: &mut String) {
        let r = &self.data.records[&e.record_id];
        let roles = catalog();
        let role = roles["roles"]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["id"] == e.role.as_str()))
            .map(|x| x[w.pick("title", "titleEn")].as_str().unwrap_or(""))
            .unwrap_or("")
            .to_owned();
        out.push_str("<div class=\"e\">");
        out.push_str(&format!("<p class=\"role\">{}</p>", esc(&role)));
        let heading = match &e.translation_en {
            Some(t) if w.en && !t.label.is_empty() => &t.label,
            _ => &e.label,
        };
        if !heading.is_empty() {
            out.push_str(&format!("<h3>{}</h3>", esc(heading)));
        }
        match (&e.translation_en, w.en) {
            (Some(t), true) => {
                out.push_str(&format!("<p class=\"text\">{}</p>", esc(&t.text)));
                out.push_str(&format!(
                    "<p class=\"tr\">{}</p><p class=\"orig\" lang=\"tr\">{}</p>",
                    if t.by == "ai" {
                        "AI translation, not reviewed by the author. Original:"
                    } else {
                        "Author's translation. Original:"
                    },
                    esc(&r.text)
                ));
            }
            (None, true) => out.push_str(&format!(
                "<p class=\"tr\">Not translated. Original:</p><p class=\"text\" lang=\"tr\">{}</p>",
                esc(&r.text)
            )),
            _ => out.push_str(&format!("<p class=\"text\">{}</p>", esc(&r.text))),
        }
        if !e.counterpart.is_empty() {
            out.push_str(&format!(
                "<p class=\"meta\">{}: {}</p>",
                w.pick("Karşısındaki görüş", "In relation to"),
                esc(&e.counterpart)
            ));
        }
        if !e.note.is_empty() {
            out.push_str(&format!(
                "<p class=\"note\">{}: {}</p>",
                w.pick("Not", "Note"),
                esc(&e.note)
            ));
        }
        let date = r
            .source
            .as_ref()
            .and_then(|s| s.timestamp.as_deref())
            .unwrap_or(&r.created_at);
        out.push_str(&format!(
            "<p class=\"meta\">{} · {} · {}</p>",
            w.attribution(&r.attribution),
            esc(&w.state(r)),
            esc(date.get(..10).unwrap_or(date))
        ));
        if e.placement == "suggested" {
            out.push_str(&format!(
                "<p class=\"meta sug\">{}</p>",
                w.pick(
                    "Haritadaki yeri AI önerisi; sahibi henüz onaylamadı.",
                    "Placement suggested by an AI; not yet confirmed by the author."
                )
            ));
        }
        let mut children: Vec<&&MapEntry> = kept
            .iter()
            .filter(|c| c.parent_id.as_ref() == Some(&e.id))
            .collect();
        children.sort_by_key(|c| (role_rank(&c.role), c.order, c.created_at.clone()));
        for c in children {
            self.export_entry(c, kept, w, out);
        }
        out.push_str("</div>");
    }

    /// A self-contained, script-free HTML document the person may read or hand
    /// to someone else. Nothing is sent anywhere; conversation titles and
    /// identifiers are left out. Pending and suggested entries are excluded
    /// unless the person asks for them, and are then marked as such.
    pub fn map_export(&self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: ExportInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Dışa aktarım yalnız açık onayla hazırlanır".into());
        }
        if !["tr", "en"].contains(&r.language.as_str()) || !bounded(&r.title, 200, false) {
            return Err("Dil veya başlık geçersiz".into());
        }
        let w = Words {
            en: r.language == "en",
        };
        let kept: Vec<&MapEntry> = self
            .data
            .map_entries
            .values()
            .filter(|e| {
                Self::exportable(
                    e,
                    &self.data.records[&e.record_id],
                    r.include_pending,
                    r.include_suggested,
                )
            })
            .collect();
        let ids: BTreeSet<&String> = kept.iter().map(|e| &e.id).collect();
        let title = if r.title.trim().is_empty() {
            w.pick("Düşünce haritam", "Map of my thinking").to_owned()
        } else {
            r.title.clone()
        };
        let cat = catalog();
        let mut body = String::new();
        for s in cat["sections"].as_array().into_iter().flatten() {
            let sid = s["id"].as_str().unwrap_or("");
            let mut top: Vec<&&MapEntry> = kept
                .iter()
                .filter(|e| {
                    e.section == sid && e.parent_id.as_ref().is_none_or(|p| !ids.contains(p))
                })
                .collect();
            if top.is_empty() {
                continue;
            }
            top.sort_by_key(|e| (role_rank(&e.role), e.order, e.created_at.clone()));
            body.push_str(&format!(
                "<section><h2>{}</h2><p class=\"q\">{}</p>",
                esc(s[w.pick("title", "titleEn")].as_str().unwrap_or("")),
                esc(s[w.pick("question", "questionEn")].as_str().unwrap_or(""))
            ));
            for e in top {
                self.export_entry(e, &kept, &w, &mut body);
            }
            body.push_str("</section>");
        }
        let scope = match (r.include_pending, w.en) {
            (false, false) => "Yalnız sahibinin inceleyip reddetmediği kayıtlar yer alır.",
            (false, true) => "Only records the author has reviewed and not rejected are included.",
            (true, false) => {
                "İnceleme bekleyen kayıtlar da yer alır; bunlar sahibinin onayladığı görüşler değildir."
            }
            (true, true) => {
                "Records awaiting review are included; these are not views the author has confirmed."
            }
        };
        let html = format!(
            "<!doctype html><html lang=\"{}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>{}</title><style>{}</style></head><body><h1>{}</h1><p class=\"meta\">{} · töre {}</p><p class=\"notice\">{} {}</p>{}</body></html>",
            r.language,
            esc(&title),
            EXPORT_CSS,
            esc(&title),
            esc(now().get(..10).unwrap_or("")),
            env!("CARGO_PKG_VERSION"),
            esc(cat[w.pick("method", "methodEn")].as_str().unwrap_or("")),
            scope,
            body
        );
        let text: String = kept
            .iter()
            .map(|e| self.data.records[&e.record_id].text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(json!({"html":html,"entryCount":kept.len(),"hash":digest(html.as_bytes()),
            "findings":findings("map-export", &text)}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn root() -> PathBuf {
        std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-map-{}", id()))
    }
    fn record(d: &mut Disk, topic: &str, kind: &str, text: &str) -> String {
        d.record_create(
            json!({"topicId":topic,"kind":kind,"text":text,"reason":""}),
            &BTreeMap::new(),
        )
        .unwrap()["record"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }
    fn setup() -> (PathBuf, Disk, String) {
        let path = root();
        let mut d = Disk::open(path.clone()).unwrap();
        let t = d
            .topic_create(json!({"title":"Yapay konu","goal":""}))
            .unwrap()["topic"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        (path, d, t)
    }
    fn add(d: &mut Disk, body: Value) -> Result<String, String> {
        d.map_add(body)
            .map(|v| v["entry"]["id"].as_str().unwrap().to_owned())
    }

    #[test]
    fn catalog_is_complete_and_bilingual() {
        let cat = catalog();
        assert_eq!(cat["sections"].as_array().unwrap().len(), 9);
        assert_eq!(cat["roles"].as_array().unwrap().len(), ROLES.len());
        for s in cat["sections"].as_array().unwrap() {
            for key in ["id", "title", "titleEn", "question", "questionEn"] {
                assert!(!s[key].as_str().unwrap().is_empty());
            }
        }
        for r in cat["roles"].as_array().unwrap() {
            assert!(ROLES.contains(&r["id"].as_str().unwrap()));
        }
    }

    #[test]
    fn add_requires_consent_valid_shape_and_one_place_per_record() {
        let (path, mut d, t) = setup();
        let r = record(&mut d, &t, "opinion", "Yapay görüş");
        let q = record(&mut d, &t, "question", "Yapay soru?");
        let ok = json!({"recordId":r,"section":"insan","role":"position","confirmedByUser":true});
        let mut no = ok.clone();
        no["confirmedByUser"] = json!(false);
        assert!(add(&mut d, no).is_err());
        for (key, value) in [
            ("section", json!("yok")),
            ("role", json!("yok")),
            ("recordId", json!("missing")),
            ("role", json!("open_question")),
            ("placement", json!("model")),
            ("extra", json!(1)),
        ] {
            let mut bad = ok.clone();
            bad[key] = value;
            assert!(add(&mut d, bad).is_err(), "{key}");
        }
        assert!(
            add(
                &mut d,
                json!({"recordId":q,"section":"insan","role":"position","confirmedByUser":true})
            )
            .is_err()
        );
        add(&mut d, ok.clone()).unwrap();
        assert!(add(&mut d, ok).is_err(), "aynı kayıt iki kez yerleşmez");
        assert_eq!(d.map_view().unwrap()["entries"].as_array().unwrap().len(), 1);
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn objections_answers_and_tests_hang_from_the_right_parent() {
        let (path, mut d, t) = setup();
        let p = record(&mut d, &t, "opinion", "Yapay pozisyon");
        let o = record(&mut d, &t, "opinion", "Yapay itiraz");
        let a = record(&mut d, &t, "opinion", "Yapay cevap");
        let x = record(&mut d, &t, "opinion", "Yapay ölçüt");
        assert!(
            add(
                &mut d,
                json!({"recordId":o,"section":"toplum","role":"objection","confirmedByUser":true})
            )
            .is_err(),
            "itiraz tek başına duramaz"
        );
        let pe = add(
            &mut d,
            json!({"recordId":p,"section":"toplum","role":"position","confirmedByUser":true}),
        )
        .unwrap();
        let oe = add(&mut d, json!({"recordId":o,"section":"toplum","role":"objection","parentId":pe,"confirmedByUser":true})).unwrap();
        assert!(
            add(&mut d, json!({"recordId":x,"section":"toplum","role":"test","parentId":oe,"confirmedByUser":true})).is_err(),
            "ölçüt itiraza bağlanmaz"
        );
        add(&mut d, json!({"recordId":a,"section":"toplum","role":"answer","parentId":oe,"confirmedByUser":true})).unwrap();
        add(&mut d, json!({"recordId":x,"section":"toplum","role":"test","parentId":pe,"confirmedByUser":true})).unwrap();
        assert!(
            d.map_remove(json!({"entryId":pe,"confirmedByUser":true}))
                .is_err(),
            "bağlı girdisi olan pozisyon çıkarılamaz"
        );
        assert!(
            d.map_update(json!({"entryId":pe,"section":"toplum","role":"position","parentId":pe,"confirmedByUser":true}))
                .is_err(),
            "girdi kendine bağlanamaz"
        );
        drop(d);
        let d = Disk::open(path.clone()).unwrap();
        assert_eq!(d.map_view().unwrap()["entries"].as_array().unwrap().len(), 4);
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn add_is_idempotent_and_update_makes_a_suggestion_the_persons_own() {
        let (path, mut d, t) = setup();
        let r = record(&mut d, &t, "opinion", "Yapay görüş");
        let rid = uuid::Uuid::new_v4().to_string();
        let input = json!({"requestId":rid,"recordId":r,"section":"bilgi","role":"premise","label":"Başlık",
            "placement":"suggested","translationEn":{"text":"Synthetic view","by":"ai"},"confirmedByUser":true});
        let first = d.map_add(input.clone()).unwrap();
        assert_eq!(d.map_add(input).unwrap(), first);
        assert_eq!(first["entry"]["placement"], "suggested");
        let id = first["entry"]["id"].as_str().unwrap();
        assert!(
            d.map_update(json!({"entryId":id,"section":"bilgi","role":"premise","confirmedByUser":false}))
                .is_err()
        );
        let updated = d
            .map_update(json!({"entryId":id,"section":"insan","role":"position","label":"Yeni","confirmedByUser":true}))
            .unwrap();
        assert_eq!(updated["entry"]["placement"], "user");
        assert_eq!(updated["entry"]["section"], "insan");
        assert!(updated["entry"].get("translationEn").is_none());
        d.map_remove(json!({"entryId":id,"confirmedByUser":true}))
            .unwrap();
        assert!(d.map_view().unwrap()["entries"].as_array().unwrap().is_empty());
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn empty_map_leaves_the_store_bytes_and_hash_unchanged() {
        let (path, mut d, t) = setup();
        let r = record(&mut d, &t, "opinion", "Yapay görüş");
        let before = fs::read(path.join("records-v1.json")).unwrap();
        assert!(!String::from_utf8_lossy(&before).contains("mapEntries"));
        let id = add(
            &mut d,
            json!({"recordId":r,"section":"insan","role":"position","confirmedByUser":true}),
        )
        .unwrap();
        d.map_remove(json!({"entryId":id,"confirmedByUser":true}))
            .unwrap();
        assert_eq!(fs::read(path.join("records-v1.json")).unwrap(), before);
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn export_is_script_free_escaped_and_keeps_unreviewed_records_out_by_default() {
        let (path, mut d, t) = setup();
        let reviewed = record(&mut d, &t, "opinion", "Onaylı <b>görüş</b> & gerekçe");
        let pending = record(&mut d, &t, "opinion", "Bekleyen görüş");
        let suggested = record(&mut d, &t, "opinion", "Önerilen yer");
        for id in [&reviewed, &suggested] {
            d.review(json!({"id":id,"expectedRevision":1,"text":if id == &reviewed {"Onaylı <b>görüş</b> & gerekçe"} else {"Önerilen yer"},
                "reason":"","review":"reviewed","adoption":"adopted","currency":"current","priority":"unspecified",
                "questionState":"not_applicable","changeReason":"Yapay inceleme.","confirmedByUser":true}))
                .unwrap();
        }
        add(&mut d, json!({"recordId":reviewed,"section":"insan","role":"position","label":"Başlık",
            "counterpart":"Yapay gelenek","translationEn":{"text":"Reviewed view","by":"ai","label":"Heading"},"confirmedByUser":true})).unwrap();
        add(
            &mut d,
            json!({"recordId":pending,"section":"insan","role":"position","confirmedByUser":true}),
        )
        .unwrap();
        add(&mut d, json!({"recordId":suggested,"section":"toplum","role":"position","placement":"suggested","confirmedByUser":true})).unwrap();
        assert!(
            d.map_export(json!({"language":"tr","confirmedByUser":false}))
                .is_err()
        );
        assert!(
            d.map_export(json!({"language":"de","confirmedByUser":true}))
                .is_err()
        );
        let tr = d
            .map_export(json!({"language":"tr","confirmedByUser":true}))
            .unwrap();
        let html = tr["html"].as_str().unwrap();
        assert_eq!(tr["entryCount"], 1);
        assert!(html.contains("Onaylı &lt;b&gt;görüş&lt;/b&gt; &amp; gerekçe"));
        assert!(!html.contains("<script") && !html.contains("http"));
        assert!(!html.contains("Bekleyen görüş") && !html.contains("Önerilen yer"));
        assert!(!html.contains("Yapay konu"), "konu başlığı dışarı çıkmaz");
        assert_eq!(tr["hash"], digest(html.as_bytes()));
        let en = d
            .map_export(json!({"language":"en","includePending":true,"includeSuggested":true,"confirmedByUser":true}))
            .unwrap();
        let html = en["html"].as_str().unwrap();
        assert_eq!(en["entryCount"], 3);
        assert!(html.contains("Reviewed view") && html.contains("AI translation, not reviewed"));
        assert!(html.contains("<h3>Heading</h3>") && !html.contains("<h3>Başlık</h3>"));
        assert!(html.contains("Not translated") && html.contains("Placement suggested by an AI"));
        assert!(html.contains("awaiting review") && html.contains("How a person should live"));
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn store_validation_rejects_a_map_the_application_would_not_create() {
        let (path, mut d, t) = setup();
        let r = record(&mut d, &t, "opinion", "Yapay görüş");
        let id = add(
            &mut d,
            json!({"recordId":r,"section":"insan","role":"position","confirmedByUser":true}),
        )
        .unwrap();
        let mut bad = d.data.clone();
        bad.map_entries.get_mut(&id).unwrap().section = "yok".into();
        assert!(validate_store(&bad).is_err());
        let mut dup = d.data.clone();
        let mut copy = dup.map_entries[&id].clone();
        copy.id = "other".into();
        dup.map_entries.insert("other".into(), copy);
        assert!(validate_store(&dup).is_err());
        fs::remove_dir_all(path).ok();
    }
}
