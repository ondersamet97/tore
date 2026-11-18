//! Exact local word/phrase groups for sources the fixed navigation themes miss.
//! Labels are private source-derived text and must not be printed in diagnostics.
use super::*;

const MAX_CLUSTERS: usize = 16;
fn useful(word: &str) -> bool {
    if word.chars().count() < 5 || word.chars().count() > 35 {
        return false;
    }
    if [
        "bir",
        "biri",
        "birisi",
        "biraz",
        "birkac",
        "birlikte",
        "birinci",
        "ikinci",
        "ucuncu",
        "icin",
        "gibi",
        "daha",
        "bunu",
        "buna",
        "bunun",
        "bunda",
        "bunlar",
        "bunlari",
        "bunlara",
        "bunlarin",
        "bunlardan",
        "benden",
        "benim",
        "benimle",
        "bana",
        "beni",
        "senin",
        "seninle",
        "senden",
        "sizin",
        "kendim",
        "kendi",
        "kendisi",
        "kendisini",
        "kendine",
        "kendini",
        "bizim",
        "bizimle",
        "sadece",
        "yalniz",
        "yalnizca",
        "simdi",
        "simdiye",
        "sonra",
        "sonraki",
        "sonunda",
        "once",
        "oncesi",
        "oncesinde",
        "onceki",
        "hepsi",
        "hepsini",
        "hepsinin",
        "hepsinden",
        "tamam",
        "tamami",
        "butun",
        "butunu",
        "tumunu",
        "tumunun",
        "nasil",
        "neden",
        "nicin",
        "nerede",
        "nereden",
        "nereye",
        "zaman",
        "zamanda",
        "kadar",
        "hangi",
        "hangisi",
        "hangisini",
        "nedir",
        "nedeni",
        "demek",
        "dedi",
        "dedim",
        "diger",
        "digeri",
        "digerleri",
        "digerlerini",
        "burada",
        "buraya",
        "buradan",
        "orada",
        "oraya",
        "orada",
        "lutfen",
        "tesekkur",
        "tesekkurler",
        "merhaba",
        "tekrar",
        "yeniden",
        "mevcut",
        "gercek",
        "gercekten",
        "farkli",
        "farkini",
        "farklari",
        "farklar",
        "sekilde",
        "seklinde",
        "durum",
        "durumu",
        "durumda",
        "olarak",
        "oldugu",
        "oldugunu",
        "olmadigi",
        "olmadigini",
        "olabilir",
        "olabiliriz",
        "olmasi",
        "olmasini",
        "olmasin",
        "olmali",
        "oldu",
        "olsun",
        "olur",
        "olacak",
        "olacagini",
        "gereken",
        "gerekiyor",
        "gerekir",
        "istiyorum",
        "istiyoruz",
        "istedigim",
        "isterim",
        "iste",
        "biliyorum",
        "bilmiyorum",
        "bence",
        "mesela",
        "ornek",
        "ornegin",
        "ornekler",
        "basit",
        "detayli",
        "ayrintili",
        "kisa",
        "uzun",
        "sonuc",
        "sonucu",
        "sonuclari",
        "bilgi",
        "bilgiler",
        "bilgileri",
        "bilgilerini",
        "acik",
        "soyle",
        "soyleyecegim",
        "hemen",
        "artik",
        "hani",
        "acaba",
        "ama",
        "cunku",
        "yani",
        "fakat",
        "ancak",
        "veya",
        "yahut",
        "baska",
        "eski",
        "yeni",
        "herhangi",
        "hicbir",
        "herkes",
        "birsey",
        "seyler",
        "seyleri",
        "hersey",
        "the",
        "this",
        "that",
        "these",
        "those",
        "there",
        "their",
        "they",
        "them",
        "then",
        "than",
        "with",
        "without",
        "from",
        "have",
        "having",
        "would",
        "could",
        "should",
        "shall",
        "please",
        "about",
        "above",
        "below",
        "before",
        "after",
        "again",
        "other",
        "another",
        "which",
        "where",
        "when",
        "what",
        "while",
        "because",
        "still",
        "already",
        "until",
        "under",
        "between",
        "within",
        "through",
        "your",
        "yours",
        "yourself",
        "myself",
        "ourselves",
        "being",
        "been",
        "does",
        "doing",
        "done",
        "make",
        "makes",
        "made",
        "need",
        "needs",
        "want",
        "wants",
        "wanted",
        "really",
        "everything",
        "something",
        "anything",
        "nothing",
        "someone",
        "every",
        "each",
        "first",
        "second",
        "third",
        "last",
        "next",
        "previous",
        "current",
        "existing",
        "based",
        "using",
        "provide",
        "given",
        "start",
        "continue",
        "complete",
        "follow",
        "following",
        "include",
        "including",
        "return",
        "summary",
        "title",
        "conversation",
        "conversations",
        "chat",
        "message",
        "question",
        "answer",
        "assistant",
        "request",
        "user",
        "context",
        "content",
        "text",
        "analyze",
        "analysis",
        "review",
        "suggestion",
        "suggestions",
        "explain",
        "example",
        "examples",
        "details",
        "detailed",
        "understand",
        "information",
        "instructions",
        "important",
        "process",
        "result",
        "results",
        "system",
        "version",
        "referenced",
        "pasted",
        "quoted",
        "attached",
        "sentetik",
        "synthetic",
        "test",
    ]
    .contains(&word)
    {
        return false;
    }
    // Generic instruction stems are unsuitable as discovery topics. This also
    // handles ordinary Turkish suffixes without stemming actual topic terms.
    ![
        "konus",
        "sohbet",
        "baslik",
        "baslig",
        "konular",
        "cesitler",
        "secenekler",
        "acmaya",
        "karar",
        "verdim",
        "bitireceg",
        "ozet",
        "acikla",
        "analiz",
        "incele",
        "istegi",
        "talep",
        "anlat",
        "oner",
        "yanit",
        "cevap",
        "kullan",
        "belirt",
        "guncel",
        "hazirla",
        "degerlendir",
        "olustur",
        "duzenle",
        "yazdi",
        "yazma",
        "yazil",
        "yapma",
        "yapil",
        "yaptig",
        "yapac",
        "dusun",
        "hakkinda",
        "ilgili",
        "konusu",
        "konuda",
        "onceki",
        "sonraki",
        "soyle",
        "inceleme",
        "gonder",
        "ekrana",
        "verdigi",
        "vereceg",
        "sorular",
        "soruyu",
        "metin",
        "metni",
        "sistemi",
        "istenen",
        "istedig",
        "dosya",
        "proje",
        "rapor",
        "planla",
    ]
    .iter()
    .any(|p| word.starts_with(p))
}
fn phrases(text: &str) -> BTreeMap<String, String> {
    // A word keeps byte offsets so every proposed label is an exact substring.
    let mut words = vec![];
    let mut start = None;
    for (at, ch) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if ch.is_alphabetic() {
            if start.is_none() {
                start = Some(at);
            }
        } else if let Some(lo) = start.take() {
            words.push((lo, at, normal(&text[lo..at])));
        }
    }
    let mut out = BTreeMap::new();
    for (lo, hi, word) in &words {
        if useful(word) {
            out.entry(word.clone())
                .or_insert_with(|| text[*lo..*hi].to_owned());
        }
    }
    for pair in words.windows(2) {
        let (lo, hi, first) = &pair[0];
        let (next_lo, next_hi, second) = &pair[1];
        if useful(first)
            && useful(second)
            && text[*hi..*next_lo].chars().all(char::is_whitespace)
            && !text[*hi..*next_lo].contains('\n')
            && text[*lo..*next_hi].chars().count() <= 50
        {
            out.entry(format!("{first} {second}"))
                .or_insert_with(|| text[*lo..*next_hi].to_owned());
        }
    }
    out
}
struct Candidate {
    label: String,
    ids: BTreeSet<String>,
    title_hits: usize,
}
pub(super) fn refine(
    store: &Store,
    conversations: &BTreeMap<String, Conversation>,
    plan: &mut Plan,
) {
    let eligible: Vec<_> = plan
        .changes
        .iter()
        .filter(|c| c.to_topic_id == "bulk-topic-source_topics" && c.retained_reason.is_none())
        .map(|c| c.conversation_id.clone())
        .collect();
    if eligible.len() < 2 {
        return;
    }
    let mut groups: BTreeMap<String, Candidate> = BTreeMap::new();
    for cid in &eligible {
        let Some(c) = conversations.get(cid) else {
            continue;
        };
        let title_terms = if title_is_generic(&c.title) {
            BTreeMap::new()
        } else {
            phrases(&bulk::clip(&c.title, 240))
        };
        let mut terms = title_terms.clone();
        let visible = visible(c);
        for text in visible.iter().take(2).chain(visible.iter().rev().take(2)) {
            terms.extend(phrases(&bulk::clip(text, 600)));
        }
        for (key, label) in terms {
            let title_hit = title_terms.contains_key(&key);
            let entry = groups.entry(key).or_insert_with(|| Candidate {
                label,
                ids: BTreeSet::new(),
                title_hits: 0,
            });
            entry.ids.insert(cid.clone());
            if title_hit {
                entry.title_hits += 1;
            }
        }
    }
    groups.retain(|_, g| g.ids.len() >= 2 && g.ids.len() <= (eligible.len() / 2).max(4));
    let mut assigned = BTreeSet::new();
    for _ in 0..MAX_CLUSTERS {
        let best = groups
            .iter()
            .filter_map(|(term, g)| {
                let count = g.ids.iter().filter(|cid| !assigned.contains(*cid)).count();
                if count < 2 {
                    return None;
                }
                let score =
                    count * (if term.contains(' ') { 4 } else { 2 }) + g.title_hits.min(count) * 3;
                Some((term.clone(), score, count))
            })
            .max_by(|a, b| {
                a.1.cmp(&b.1)
                    .then(a.2.cmp(&b.2))
                    .then_with(|| b.0.cmp(&a.0))
            });
        let Some((term, _, _)) = best else {
            break;
        };
        let g = &groups[&term];
        let tid = format!("bulk-topic-cluster-{}", digest(term.as_bytes()));
        let title = format!("“{}” çevresindeki konuşmalar", bulk::clip(&g.label, 50));
        if !store.topics.contains_key(&tid) {
            plan.topics.entry(tid.clone()).or_insert_with(||Topic{id:tid.clone(),title,goal:"Birden çok kaynakta ortak geçen yerel sözcük/öbek etrafında gezinme önerisi. Anlam eşitliği veya kişisel görüş çıkarımı değildir.".into(),created_at:now(),creation_request_hash:format!("{RULE_VERSION}:{term}")});
        }
        for change in &mut plan.changes {
            if change.to_topic_id == "bulk-topic-source_topics"
                && g.ids.contains(&change.conversation_id)
                && assigned.insert(change.conversation_id.clone())
            {
                change.to_topic_id = tid.clone();
                change.reason="Sabit üst tema bulunamadı. Birden çok kaynağın başlığında veya seçili görünür kullanıcı sözünde ortak geçen ayırt edici sözcük/öbekle yerel bir gezinme kümesi önerildi. Aynı görüş veya anlam taşıdıkları iddia edilmez; özgün altbaşlıklar ayrı kalır.".into();
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopwords_and_exact_phrase_labels_do_not_create_instruction_topics() {
        let p = phrases(
            "Şimdi bu konuşmaları tekrar incele; konuşma başlığı öner. Crystal garden çeşitleri.",
        );
        assert!(!p.contains_key("konusmalari"));
        assert!(!p.contains_key("basligi"));
        assert!(!p.contains_key("simdi"));
        assert_eq!(p["crystal garden"], "Crystal garden");
        assert!(!p.contains_key("garden cesitleri"));
        assert!(phrases("please analyze previous conversation title instructions").is_empty());
    }
}
