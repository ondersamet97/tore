//! Local organization changes navigation, never the author's claims or review.
use super::*;

const RULE_VERSION: &str = "local-organization-v2";
const OTHER: &str = "bulk-topic-other";
#[path = "records_organize_clusters.rs"]
mod clusters;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Change {
    conversation_id: String,
    from_topic_id: String,
    to_topic_id: String,
    subtopic_title: String,
    reason: String,
    record_ids: Vec<String>,
    retained_reason: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct OrganizationReceipt {
    preview_hash: String,
    rule_version: String,
    created_at: String,
    source_hash: String,
    moved: usize,
    subtopics_updated: usize,
    records_moved: usize,
    topics_created: usize,
    retained_dependency_count: usize,
    backup_id: Option<String>,
    changes: Vec<Change>,
}
struct Plan {
    preview_hash: String,
    source_hash: String,
    topics: BTreeMap<String, Topic>,
    changes: Vec<Change>,
}
struct Domain {
    key: &'static str,
    title: &'static str,
    words: &'static [&'static str],
}
// Asterisks permit explicit stems, never arbitrary substring matching. These
// labels are navigation suggestions, not inferred identity, intent or ideology.
const DOMAINS: &[Domain] = &[
    Domain {
        key: "ai_tools",
        title: "AI araçları ve geliştirme",
        words: &[
            "yapay zeka",
            "artificial intelligence",
            "llm",
            "chatgpt",
            "claude",
            "codex",
            "gemini",
            "openrouter",
            "deepseek",
            "ollama",
            "hugging face",
            "huggingface",
            "prompt*",
            "mcp",
            "dify",
            "agent",
            "agents",
            "ajan",
            "fine tuning",
            "fine-tun*",
            "inference",
            "token",
            "machine learning",
            "makine ogren*",
            "neural network",
            "gpt",
            "qwen",
            "kimi",
            "glm",
            "nvidia",
            "yazilim*",
            "software",
            "programlama",
            "programming",
            "kodlama",
            "kaynak kod*",
            "source code",
            "python",
            "rust",
            "javascript",
            "typescript",
            "html",
            "css",
            "react",
            "next.js",
            "node.js",
            "npm",
            "vite",
            "webpack",
            "frontend",
            "backend",
            "api",
            "json",
            "jsonl",
            "sqlite",
            "sql",
            "veritabani",
            "database",
            "github",
            "git",
            "repository",
            "repo",
            "terminal",
            "docker",
            "linux",
            "macos",
            "windows",
            "chrome",
            "tarayici",
            "browser",
            "debug*",
            "bug",
            "compile*",
            "derleme",
            "build",
            "localhost",
            "http",
            "https",
            "server",
            "sunucu",
            "web sitesi",
            "website",
            "webpage",
            "web app",
            "web uygulama*",
            "cli",
            "sdk",
            "oauth",
            "ssh",
            "keychain",
            "encryption",
            "siber",
            "cybersecurity",
            "parola",
            "password",
            "sifreleme",
            "bilgisayar",
            "macbook",
            "ram",
            "gpu",
            "cpu",
            "isletim sistemi",
            "kurulum",
            "installation",
            "install",
            "restore",
            "backup",
            "yedekleme",
            "hata ayiklama",
        ],
    },
    Domain {
        key: "products",
        title: "Ürünler ve proje geliştirme",
        words: &[
            "tore*",
            "izge*",
            "beyin uygulama*",
            "rapor uygulama*",
            "urun",
            "urunler",
            "urunu",
            "urunun",
            "product",
            "startup",
            "girisim",
            "is modeli",
            "business model",
            "is fikri",
            "business idea",
            "mvp",
            "prototip*",
            "prototype",
            "roadmap",
            "yol haritasi",
            "pazar arastirma*",
            "market research",
            "musteri",
            "customer",
            "monetization",
            "gelir modeli",
            "saas",
            "harness",
            "hackathon",
            "proje yonetimi",
            "project management",
            "is gelistirme",
        ],
    },
    Domain {
        key: "career",
        title: "Kariyer ve portföy",
        words: &[
            "kariyer*",
            "career*",
            "portfolio",
            "portfoy*",
            "ozgecmis",
            "resume",
            "cv",
            "linkedin",
            "is basvur*",
            "job application",
            "job search",
            "is arama",
            "is arayisi",
            "mulakat*",
            "interview",
            "meslek*",
            "maas",
            "salary",
            "ucret",
            "ise alim",
            "recruit*",
            "calisma hayati",
            "freelanc*",
            "cover letter",
            "motivasyon mektubu",
            "is ilani",
            "is ilanlari",
        ],
    },
    Domain {
        key: "funding",
        title: "Fon ve destek araştırmaları",
        words: &[
            "hibe*",
            "fon basvur*",
            "fon arayisi",
            "fon bulma",
            "destek program*",
            "funding",
            "grant",
            "grants",
            "fellowship",
            "burs",
            "burslar",
            "scholarship",
            "mozilla",
            "emergent ventures",
            "futo",
            "spiral",
            "yatirimci",
            "yatirim turu",
            "venture capital",
            "accelerator",
            "kulucka",
            "incubator",
        ],
    },
    Domain {
        key: "ideology",
        title: "Görüşler ve toplum",
        words: &[
            "ideoloji*",
            "ideolojim",
            "felsefe*",
            "philosoph*",
            "etik",
            "ethics",
            "ahlak*",
            "siyaset*",
            "politic*",
            "politika*",
            "demokrasi*",
            "democracy",
            "cumhuriyet*",
            "kemalizm",
            "kemalist",
            "sosyalizm",
            "sosyalist",
            "socialism",
            "kapitalizm",
            "capitalism",
            "liberal*",
            "komunizm",
            "anarsizm",
            "milliyetcilik",
            "devlet",
            "hukumet",
            "government",
            "toplum*",
            "societ*",
            "insanlik",
            "humanity",
            "insan haklari",
            "esitlik",
            "equality",
            "adalet",
            "justice",
            "ozgurluk",
            "freedom",
            "yonetisim",
            "governance",
            "kurumsal tasarim",
            "secim sistemi",
            "election",
            "demokrasi",
            "jeopolitik",
            "geopolitic*",
            "dunya duzeni",
            "ekonomi politik",
            "dunya gorusu",
            "varolus*",
            "inanc",
            "din felsefesi",
            "bilinc",
        ],
    },
    Domain {
        key: "science",
        title: "Bilim ve araştırma",
        words: &[
            "bilim*",
            "science",
            "scientific",
            "arastirma yontemi",
            "research method",
            "hipotez",
            "hypothesis",
            "deney",
            "experiment",
            "matematik*",
            "mathematic*",
            "istatistik*",
            "statistic*",
            "fizik",
            "physics",
            "kimya",
            "chemistry",
            "biyoloji*",
            "biology",
            "noron*",
            "neuron*",
            "sinirbilim",
            "neuroscience",
            "evrim",
            "evolution",
            "kozmik",
            "cosmic",
            "kozmoloji",
            "cosmology",
            "astronomi",
            "astronomy",
            "evren",
            "universe",
            "kuantum",
            "quantum",
            "fraktal*",
            "fractal*",
            "galaksi*",
            "galax*",
            "uzay",
            "space exploration",
            "genetik",
            "genetic*",
            "hucre",
            "dna",
            "arxiv",
            "makale incelemesi",
            "akademik",
            "academic",
            "teorem",
            "theorem",
            "entropi",
            "entropy",
            "foton",
            "photon",
        ],
    },
    Domain {
        key: "markets",
        title: "Piyasalar ve yatırım araştırmaları",
        words: &[
            "yatirim*",
            "invest*",
            "altin",
            "gold",
            "bitcoin",
            "btc",
            "ethereum",
            "eth",
            "binance",
            "crypto*",
            "kripto*",
            "borsa*",
            "stock market",
            "forex",
            "trading",
            "trader",
            "backtest*",
            "osint",
            "finans*",
            "finance",
            "financial",
            "hisse*",
            "sermaye",
            "doviz",
            "enflasyon",
            "inflation",
            "faiz",
            "interest rate",
            "teknik analiz",
            "technical analysis",
            "ekonomik dongu",
            "piyasa*",
            "emtia",
            "commodity",
            "tahvil",
            "bond market",
            "etf",
            "risk yonetimi",
            "portfoy dagilimi",
            "yatirim fonu",
        ],
    },
    Domain {
        key: "film",
        title: "Film ve hikâye",
        words: &[
            "film*",
            "sinema*",
            "cinema",
            "senaryo*",
            "screenplay",
            "scriptwriting",
            "hikaye*",
            "story",
            "storytelling",
            "treatment",
            "karakter tasarimi",
            "character design",
            "kurgu",
            "fiction",
            "roman",
            "novel",
            "siir",
            "poem",
            "poetry",
            "juri",
            "jury",
        ],
    },
    Domain {
        key: "creative",
        title: "Tasarım ve yaratıcı üretim",
        words: &[
            "video*",
            "animasyon",
            "animation",
            "hyperframes",
            "muzik",
            "music",
            "sarki",
            "song",
            "gorsel*",
            "visual*",
            "resim",
            "image generation",
            "illustration",
            "illustrasyon",
            "fotograf*",
            "photograph*",
            "tasarim",
            "design",
            "logo",
            "afis",
            "poster",
            "renk paleti",
            "color palette",
            "yaratici",
            "creative",
            "sanat",
            "artwork",
        ],
    },
    Domain {
        key: "anime",
        title: "Anime ve izleme listesi",
        words: &[
            "anime",
            "myanimelist",
            "manga",
            "mal list",
            "animelist",
            "izleme listesi",
            "watchlist",
            "dizi oneri*",
            "series recommendation",
            "manhwa",
            "bolum oneri*",
        ],
    },
    Domain {
        key: "games",
        title: "Oyunlar",
        words: &[
            "oyun",
            "oyunlar",
            "gaming",
            "game",
            "games",
            "steam",
            "playstation",
            "nintendo",
            "xbox",
            "rpg",
        ],
    },
    Domain {
        key: "health",
        title: "Sağlık ve yaşam",
        words: &[
            "saglik*",
            "health",
            "medical",
            "hastalik*",
            "hastane",
            "hospital",
            "doktor",
            "doctor",
            "ilac",
            "medicine",
            "tedavi*",
            "treatment plan",
            "semptom",
            "symptom",
            "agri",
            "pain",
            "uyku",
            "sleep",
            "beslenme",
            "nutrition",
            "diyet",
            "diet",
            "egzersiz",
            "exercise",
            "fitness",
            "antrenman",
            "workout",
            "vitamin",
            "kalori",
            "calorie",
            "protein",
            "alerji",
            "allergy",
            "sigara",
            "smoking",
            "dis sagligi",
            "dental",
            "cilt",
            "skin care",
            "hormon",
            "hormone",
            "tansiyon",
            "blood pressure",
        ],
    },
    Domain {
        key: "personal",
        title: "İlişkiler ve kişisel deneyimler",
        words: &[
            "psikoloji*",
            "psycholog*",
            "terapi",
            "therapy",
            "kaygi",
            "anxiety",
            "depresyon",
            "depression",
            "stres",
            "stress",
            "duygu*",
            "emotion*",
            "yalnizlik",
            "loneliness",
            "arkadas*",
            "friendship",
            "iliski",
            "iliskiler",
            "relationship",
            "aile",
            "family",
            "sevgili",
            "romantik",
            "romantic",
            "motivasyon",
            "motivation",
            "ozguven",
            "self confidence",
            "kisilik",
            "personality",
            "kendimi",
            "kendini tanima",
            "kisisel gelisim",
            "personal development",
            "alisakanlik",
            "aliskanlik",
            "habit",
            "ruya",
            "dream interpretation",
        ],
    },
    Domain {
        key: "languages",
        title: "Dil ve çeviri",
        words: &[
            "ceviri*",
            "cevir",
            "tercume*",
            "translat*",
            "ingilizce*",
            "english",
            "almanca*",
            "german",
            "sirpca*",
            "serbian language",
            "italyanca",
            "italian",
            "rusca",
            "russian",
            "arapca",
            "arabic",
            "japonca",
            "japanese",
            "fransizca",
            "french",
            "ispanyolca",
            "spanish",
            "dil ogren*",
            "language learning",
            "gramer",
            "grammar",
            "telaffuz",
            "pronunciation",
            "kelime anlami",
            "word meaning",
            "dilbilgisi",
            "sozluk",
            "dictionary",
            "dil bilgisi",
            "turkce karsiligi",
        ],
    },
    Domain {
        key: "communication",
        title: "Yazışmalar ve iletişim",
        words: &[
            "e-posta",
            "eposta",
            "email",
            "e-mail",
            "mail",
            "mesaj",
            "mesajlar",
            "message",
            "whatsapp",
            "telegram",
            "discord",
            "slack",
            "outlook",
            "gmail",
            "yazi duzelt*",
            "metin duzelt*",
            "rewrite",
            "proofread",
            "mektup",
            "letter",
            "dilekce",
            "yanit taslagi",
            "cevap yaz",
            "reply draft",
            "iletisim",
            "communication",
            "konusma metni",
            "speech draft",
            "sunum metni",
            "duyuru",
            "announcement",
            "sikayet metni",
        ],
    },
    Domain {
        key: "learning",
        title: "Öğrenme ve okuma",
        words: &[
            "ogren*",
            "learn*",
            "egitim",
            "education",
            "ders",
            "dersler",
            "course",
            "kurs",
            "sinav",
            "exam",
            "universite",
            "university",
            "akademi",
            "okul",
            "school",
            "ogrenci",
            "student",
            "kitap",
            "kitaplar",
            "kitapligi",
            "book",
            "books",
            "library",
            "kutuphane",
            "okuma",
            "reading",
            "okumak",
            "calisma plani",
            "study plan",
            "tutorial",
            "sertifika",
            "certificate",
            "tez",
            "thesis",
            "mufredat",
            "curriculum",
            "ogret*",
            "teach*",
        ],
    },
    Domain {
        key: "history",
        title: "Tarih ve kültür",
        words: &[
            "tarih arastirmasi",
            "tarihi olay",
            "tarihsel",
            "history of",
            "historical",
            "osmanli",
            "ottoman",
            "antik",
            "ancient",
            "mitoloji",
            "mytholog*",
            "kultur",
            "culture",
            "cultural",
            "medeniyet",
            "civilization",
            "arkeoloji",
            "archaeolog*",
            "etimoloji",
            "etymolog*",
            "orta cag",
            "middle ages",
            "imparatorluk",
            "empire",
            "roma tarihi",
            "roman empire",
            "ronesans",
            "renaissance",
            "dunya savasi",
            "world war",
            "antropoloji",
            "anthropolog*",
            "folklor",
            "folklore",
            "gelenek",
            "tradition",
            "dinler tarihi",
            "religious history",
            "muzeler",
            "museum",
        ],
    },
    Domain {
        key: "travel",
        title: "Seyahat ve yerler",
        words: &[
            "seyahat",
            "travel",
            "trip",
            "gezi",
            "gezilecek",
            "visit",
            "tatil",
            "holiday",
            "vacation",
            "rota",
            "route",
            "ucak",
            "flight",
            "bilet",
            "ticket",
            "havaalani",
            "airport",
            "otel",
            "hotel",
            "hostel",
            "konaklama",
            "accommodation",
            "turizm",
            "tourism",
            "tourist",
            "belgrad",
            "belgrade",
            "sirbistan",
            "serbia",
            "izmir",
            "antalya",
            "berlin",
            "londra",
            "london",
            "paris",
            "amsterdam",
            "viyana",
            "vienna",
            "tokyo",
            "istanbul",
            "ankara",
            "ulasim",
            "transport",
            "otobus",
            "bus",
            "tren",
            "train station",
            "harita",
            "map",
            "nasil giderim",
            "nasil gidilir",
            "nerede yenir",
            "restaurant",
            "restoran",
            "kafe",
            "cafe",
        ],
    },
    Domain {
        key: "administration",
        title: "Resmî işlemler ve haklar",
        words: &[
            "vize",
            "visa",
            "oturum",
            "residence",
            "residency",
            "calisma izni",
            "work permit",
            "gocmen",
            "immigra*",
            "pasaport",
            "passport",
            "vatandaslik",
            "citizenship",
            "konsolosluk",
            "consulate",
            "elcilik",
            "embassy",
            "hukuk",
            "legal",
            "law",
            "avukat",
            "lawyer",
            "sozlesme",
            "contract",
            "telif",
            "copyright",
            "lisans",
            "license",
            "licensing",
            "vergi",
            "tax",
            "sigorta",
            "insurance",
            "gdpr",
            "kvkk",
            "mahkeme",
            "court",
            "sirket kurma",
            "company registration",
            "belediye",
            "municipal",
            "ikamet",
            "noter",
            "notary",
        ],
    },
    Domain {
        key: "planning",
        title: "Günlük planlama",
        words: &[
            "gunluk plan",
            "haftalik plan",
            "daily plan",
            "weekly plan",
            "takvim",
            "calendar",
            "hatirlatici",
            "reminder",
            "yapilacaklar",
            "todo",
            "to-do",
            "task list",
            "gorev listesi",
            "zaman yonetimi",
            "time management",
            "verimlilik",
            "productivity",
        ],
    },
    Domain {
        key: "archives",
        title: "Notlar, belgeler ve arşiv",
        words: &[
            "notion",
            "obsidian",
            "not defteri",
            "notebook",
            "arsiv",
            "archive",
            "dosya duzeni",
            "file organization",
            "klasor",
            "folder",
            "raporlari tasi",
            "rapor tasima",
            "raporla",
            "pdf",
            "dokuman",
            "document",
            "dosyalar",
            "files",
            "bilgi yonetimi",
            "knowledge management",
            "konusma gecmisi",
            "chat history",
            "notlar",
            "notes",
            "katalog",
            "catalog",
        ],
    },
    Domain {
        key: "everyday",
        title: "Günlük yaşam ve ihtiyaçlar",
        words: &[
            "alisveris",
            "shopping",
            "satinalma",
            "satin alma",
            "fiyat karsilastir*",
            "price comparison",
            "indirim",
            "discount",
            "siparis",
            "order tracking",
            "kargo",
            "shipping",
            "teslimat",
            "delivery",
            "yemek",
            "food",
            "tarif",
            "recipe",
            "kahve",
            "coffee",
            "mutfak",
            "kitchen",
            "temizlik",
            "cleaning",
            "camasir",
            "laundry",
            "kira",
            "rent",
            "ev arama",
            "apartment",
            "tasinma",
            "moving house",
            "fatura",
            "bill",
            "abonelik",
            "subscription",
            "internet paketi",
            "mobil hat",
            "telefon",
            "phone",
            "ayakkabi",
            "shoe",
            "kiyafet",
            "clothes",
            "giyim",
            "clothing",
            "hava durumu",
            "weather",
            "tamir",
            "repair",
        ],
    },
];
fn normal(s: &str) -> String {
    bulk::folded(s)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn keyword(text: &str, word: &str) -> bool {
    let (key, stem) = word.strip_suffix('*').map_or((word, false), |s| (s, true));
    text.match_indices(key).any(|(at, _)| {
        !text[..at]
            .chars()
            .next_back()
            .is_some_and(char::is_alphanumeric)
            && (stem
                || !text[at + key.len()..]
                    .chars()
                    .next()
                    .is_some_and(char::is_alphanumeric))
    })
}
fn visible(c: &Conversation) -> Vec<String> {
    let Ok(branch) = bulk::branch(c) else {
        return vec![];
    };
    // The first and most recent visible turns provide context without letting
    // enormous pasted documents or repeated words dominate classification.
    let texts: Vec<_> = branch.into_iter().filter_map(bulk::visible_text).collect();
    texts
        .iter()
        .take(4)
        .chain(texts.iter().skip(4).rev().take(8))
        .map(|x| bulk::clip(x, 1800))
        .collect()
}
fn title_is_generic(title: &str) -> bool {
    let n = normal(title);
    n.chars().count() < 5
        || [
            "new chat",
            "untitled",
            "yeni sohbet",
            "yeni konusma",
            "sohbet",
            "conversation",
            "chat",
            "basliksiz",
            "test",
            "merhaba",
            "hello",
        ]
        .contains(&n.as_str())
        || [
            "konusma basligi",
            "sohbet basligi",
            "baslik onerisi",
            "baslik olustur",
            "baslik uret",
            "conversation title",
            "chat title",
            "conversation summary",
            "konusma ozeti",
            "sohbet ozeti",
            "konusma analizi",
            "ozet talebi",
        ]
        .iter()
        .any(|p| n.contains(p))
}
fn subtopic(c: &Conversation, visible: &[String]) -> String {
    if !title_is_generic(&c.title) {
        return bulk::clip(c.title.trim(), 240);
    }
    if let Some(text) = visible.iter().find(|t| t.chars().count() >= 12) {
        // Exact contiguous excerpt, with no generated paraphrase or attribution.
        return bulk::clip(text.trim(), 240);
    }
    if !c.title.trim().is_empty() {
        return bulk::clip(c.title.trim(), 240);
    }
    "Başlıksız kaynak — görünür kullanıcı bağlamı yok".into()
}
fn classify(c: &Conversation, visible: &[String]) -> (&'static str, &'static str, String) {
    if c.messages.is_empty() {
        return ("incomplete_sources", "İçeriği eksik kaynaklar", "Kaynakta mesaj bulunmuyor. Özgün başlık korundu; içerik gelmeden konu veya görüş çıkarılmadı.".into());
    }
    let title = if title_is_generic(&c.title) {
        String::new()
    } else {
        normal(&c.title)
    };
    let bodies: Vec<_> = visible.iter().map(|x| normal(x)).collect();
    let mut scores: Vec<_> = DOMAINS
        .iter()
        .filter_map(|domain| {
            let title_hits = domain
                .words
                .iter()
                .filter(|w| keyword(&title, w))
                .count()
                .min(4);
            let body_hits = domain
                .words
                .iter()
                .filter(|w| bodies.iter().any(|b| keyword(b, w)))
                .count()
                .min(4);
            let score = title_hits * 8 + body_hits;
            (score > 0).then_some((domain, score, title_hits, body_hits))
        })
        .collect();
    scores.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.key.cmp(b.0.key)));
    let Some((first, score, title_hits, body_hits)) = scores.first().copied() else {
        if visible.is_empty() {
            return ("limited_context", "Bağlamı sınırlı kaynaklar", "Başlık açık bir temayla eşleşmedi; seçili ve görünür kullanıcı bağlamı bulunmuyor. Altbaşlık kaynak başlığını korur; dal veya içerik incelenmeli.".into());
        }
        return ("source_topics", "Kaynak başlığıyla izlenecekler", "Yerel tema kuralları yeterli eşleşme bulamadı. Özgün başlık veya birebir kullanıcı kesiti altbaşlık olarak korundu; üst tema inceleme bekler.".into());
    };
    if let Some((second, second_score, second_title, _)) = scores.get(1) {
        let tied_titles = title_hits > 0 && *second_title > 0 && second_score * 2 >= score;
        let tied_bodies = title_hits == 0
            && *second_title == 0
            && *second_score >= 1
            && second_score + 1 >= score;
        if tied_titles || tied_bodies {
            return (
                "cross_domain",
                "Birden çok alan",
                format!(
                    "Başlık/seçili kullanıcı bağlamı birden çok temayla eşleşti: {} ve {}. Tek tema iddiası kurulmadı; kaynak başlıklı altbaşlık korundu.",
                    first.title, second.title
                ),
            );
        }
    }
    if title_hits == 0 && body_hits < 2 {
        return (
            first.key,
            first.title,
            format!(
                "Zayıf yerel tema önerisi: {}. Seçili görünür kullanıcı bağlamında tek bir sözcük işareti bulundu; başlık doğrulaması yok. Bu gezinme önerisi inceleme bekler, görüş veya benimseme çıkarımı değildir.",
                first.title
            ),
        );
    }
    (
        first.key,
        first.title,
        format!(
            "Yerel düzenleme önerisi: {}. {} Bu bir kullanıcı görüşü, onay veya benimseme çıkarımı değildir.",
            first.title,
            if title_hits > 0 {
                "Özgün başlıktaki sözcükler ağırlıklı kullanıldı."
            } else {
                "Yalnız seçili daldaki görünür kullanıcı sözlerinde birden çok tema işareti bulundu."
            }
        ),
    )
}
fn records_for_link(store: &Store, link: &ConversationLink) -> Vec<String> {
    store
        .records
        .values()
        .filter(|r| {
            r.topic_id == link.topic_id
                && (link.candidate_ids.contains(&r.id)
                    || r.source
                        .as_ref()
                        .is_some_and(|s| s.conversation_id.as_ref() == Some(&link.conversation_id)))
        })
        .map(|r| r.id.clone())
        .collect()
}
fn retained_reason(store: &Store, ids: &[String]) -> Option<String> {
    let ids: BTreeSet<_> = ids.iter().collect();
    if store.packets.values().any(|p| {
        p.record_ids
            .iter()
            .chain(&p.proposal_ids)
            .any(|id| ids.contains(id))
    }) {
        return Some("Bu konuşmanın kaydı daha önce hazırlanmış devam paketinde kullanılıyor; paket anlık görüntüsünü korumak için üst konu taşınmadı.".into());
    }
    if store
        .records
        .values()
        .any(|r| ids.contains(&r.id) && r.source.as_ref().is_some_and(|s| s.reply_id.is_some()))
    {
        return Some("Bir kayıt mevcut AI yanıtına bağlı; yanıtın konu bağlantısını korumak için üst konu taşınmadı.".into());
    }
    if store.records.values().any(|r| {
        r.answers_question_id
            .as_ref()
            .is_some_and(|q| ids.contains(&r.id) != ids.contains(q))
    }) {
        return Some("Bu konuşmanın kaydı başka bir kayıt grubuyla soru–yanıt ilişkisi taşıyor; ilişkiyi korumak için üst konu taşınmadı.".into());
    }
    None
}
pub(super) fn validate_receipts(store: &Store) -> Result<(), String> {
    for (key, r) in &store.organization_receipts {
        if key != &r.preview_hash
            || !bounded(key, 100, true)
            || !bounded(&r.rule_version, 100, true)
            || !bounded(&r.created_at, 100, true)
            || !bounded(&r.source_hash, 100, true)
            || r.changes.len() > 5000
            || r.subtopics_updated != r.changes.len()
            || r.moved
                != r.changes
                    .iter()
                    .filter(|c| c.from_topic_id != c.to_topic_id)
                    .count()
            || r.records_moved
                != r.changes
                    .iter()
                    .filter(|c| c.from_topic_id != c.to_topic_id)
                    .map(|c| c.record_ids.len())
                    .sum::<usize>()
            || r.retained_dependency_count
                != r.changes
                    .iter()
                    .filter(|c| c.retained_reason.is_some())
                    .count()
        {
            return Err("Konu düzenleme makbuzu geçersiz".into());
        }
        let mut conversations = BTreeSet::new();
        let mut records = BTreeSet::new();
        for c in &r.changes {
            if !conversations.insert(&c.conversation_id)
                || !store.conversation_links.contains_key(&c.conversation_id)
                || !store.topics.contains_key(&c.from_topic_id)
                || !store.topics.contains_key(&c.to_topic_id)
                || !bounded(&c.subtopic_title, 1000, true)
                || !bounded(&c.reason, 2000, true)
                || c.retained_reason
                    .as_ref()
                    .is_some_and(|x| !bounded(x, 2000, true))
                || c.record_ids.iter().any(|id| {
                    !records.insert(id)
                        || !store.records.get(id).is_some_and(|r| {
                            r.source.as_ref().is_some_and(|s| {
                                s.conversation_id.as_ref() == Some(&c.conversation_id)
                            })
                        })
                })
            {
                return Err("Konu düzenleme makbuzunun kaynak bağlantısı geçersiz".into());
            }
        }
    }
    Ok(())
}
impl Disk {
    fn organize_plan(
        &self,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Plan, String> {
        self.check()?;
        let source_hash = hash(conversations)?;
        let preview_hash = hash(
            &json!({"ruleVersion":RULE_VERSION,"stateHash":hash(&self.data)?,"sourceHash":source_hash}),
        )?;
        let mut plan = Plan {
            preview_hash,
            source_hash,
            topics: BTreeMap::new(),
            changes: vec![],
        };
        for link in self
            .data
            .conversation_links
            .values()
            .filter(|l| l.topic_id == OTHER && l.subtopic_title.is_none())
        {
            let c = conversations
                .get(&link.conversation_id)
                .ok_or("Düzenlenecek kaynak konuşma bulunamadı; kaynakları yeniden yükleyin.")?;
            let visible = visible(c);
            let subtopic_title = subtopic(c, &visible);
            let (key, title, reason) = classify(c, &visible);
            let record_ids = records_for_link(&self.data, link);
            let retained_reason = retained_reason(&self.data, &record_ids);
            let tid = if retained_reason.is_some() {
                link.topic_id.clone()
            } else {
                format!("bulk-topic-{key}")
            };
            if !self.data.topics.contains_key(&tid) {
                plan.topics.entry(tid.clone()).or_insert_with(||Topic { id:tid.clone(),title:title.into(),goal:"Yerel düzenleme için önerilen üst tema. Altbaşlıklar özgün kaynak başlıklarını korur; görüşlerin durumu kullanıcıya aittir.".into(),created_at:now(),creation_request_hash:format!("{RULE_VERSION}:{key}") });
            }
            plan.changes.push(Change {
                conversation_id: link.conversation_id.clone(),
                from_topic_id: link.topic_id.clone(),
                to_topic_id: tid,
                subtopic_title,
                reason,
                record_ids,
                retained_reason,
            });
        }
        clusters::refine(&self.data, conversations, &mut plan);
        plan.topics
            .retain(|id, _| plan.changes.iter().any(|c| &c.to_topic_id == id));
        if self.data.topics.len() + plan.topics.len() > 200 {
            return Err("Düzenleme 200 konu sınırını aşıyor; kısmi düzenleme yapılmadı. Mevcut konu sayısını azaltmadan plan uygulanamaz.".into());
        }
        Ok(plan)
    }
    pub fn organize_preview(
        &self,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Value, String> {
        let plan = self.organize_plan(conversations)?;
        let mut topics: BTreeMap<String, Value> = BTreeMap::new();
        for c in &plan.changes {
            let topic = self
                .data
                .topics
                .get(&c.to_topic_id)
                .or_else(|| plan.topics.get(&c.to_topic_id))
                .ok_or("Düzenleme konusu bulunamadı")?;
            let row = topics.entry(topic.id.clone()).or_insert_with(
                || json!({"id":topic.id,"title":topic.title,"conversationCount":0}),
            );
            row["conversationCount"] = json!(row["conversationCount"].as_u64().unwrap_or(0) + 1);
        }
        Ok(
            json!({"previewHash":plan.preview_hash,"stateHash":hash(&self.data)?,"sourceHash":plan.source_hash,"ruleVersion":RULE_VERSION,"conversationCount":plan.changes.len(),"moveCount":plan.changes.iter().filter(|c|c.from_topic_id!=c.to_topic_id).count(),"subtopicCount":plan.changes.len(),"recordMoveCount":plan.changes.iter().filter(|c|c.from_topic_id!=c.to_topic_id).map(|c|c.record_ids.len()).sum::<usize>(),"retainedDependencyCount":plan.changes.iter().filter(|c|c.retained_reason.is_some()).count(),"topics":topics.values().collect::<Vec<_>>(),"changes":plan.changes,"warnings":["Bu yerel tema önerisidir; AI değerlendirmesi değildir. Başlıklar ve seçili daldaki görünür kullanıcı metni kullanılır; asistan sözleri görüş kanıtı sayılmaz.","Yeni onay, benimseme, güncellik veya açık soru durumu oluşturulmaz. Kaynaklar, metinler, inceleme geçmişi ve devam paketleri korunur.","Birden çok alan ve yetersiz bağlam gerekçeleri altbaşlıkla birlikte görünür; tema ataması kesinlik iddiası taşımaz."]}),
        )
    }
    pub fn organize_apply(
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
            return Err("Konu düzenleme açık kullanıcı onayı gerektirir.".into());
        }
        if let Some(receipt) = self.data.organization_receipts.get(&r.preview_hash) {
            if receipt.source_hash != hash(conversations)? {
                return Err("Kaynak konuşmalar değişti; önizlemeyi yenileyin.".into());
            }
            return self.organization_result(receipt, true);
        }
        let plan = self.organize_plan(conversations)?;
        if plan.preview_hash != r.preview_hash {
            return Err("Konuşmalar veya konu defteri değişti; önizlemeyi yenileyin.".into());
        }
        if plan.changes.is_empty() {
            return Ok(
                json!({"moved":0,"subtopicsUpdated":0,"recordsMoved":0,"topicsCreated":0,"retainedDependencyCount":0,"backupId":null,"stateHash":hash(&self.data)?,"alreadyApplied":true}),
            );
        }
        let mut next = self.data.clone();
        let mut receipt = OrganizationReceipt {
            preview_hash: plan.preview_hash.clone(),
            rule_version: RULE_VERSION.into(),
            created_at: now(),
            source_hash: plan.source_hash,
            moved: 0,
            subtopics_updated: plan.changes.len(),
            records_moved: 0,
            topics_created: plan.topics.len(),
            retained_dependency_count: 0,
            backup_id: None,
            changes: plan.changes,
        };
        next.topics.extend(plan.topics);
        for c in &receipt.changes {
            let link = next
                .conversation_links
                .get_mut(&c.conversation_id)
                .ok_or("Düzenlenecek bağlantı bulunamadı")?;
            link.topic_id = c.to_topic_id.clone();
            link.subtopic_title = Some(c.subtopic_title.clone());
            link.classification_reason = c.retained_reason.as_ref().map_or_else(
                || c.reason.clone(),
                |retained| format!("{} {}", c.reason, retained),
            );
            if c.retained_reason.is_some() {
                receipt.retained_dependency_count += 1;
            }
            if c.from_topic_id != c.to_topic_id {
                receipt.moved += 1;
                for rid in &c.record_ids {
                    next.records
                        .get_mut(rid)
                        .ok_or("Düzenlenecek kayıt bulunamadı")?
                        .topic_id = c.to_topic_id.clone();
                    receipt.records_moved += 1;
                }
            }
        }
        next.organization_receipts
            .insert(plan.preview_hash.clone(), receipt.clone());
        validate_store(&next)?;
        persistence::validate_sources(&next, conversations)?;
        let backup = self.backup()?;
        receipt.backup_id = backup["backupId"].as_str().map(str::to_owned);
        next.organization_receipts
            .insert(plan.preview_hash, receipt.clone());
        self.commit(next)?;
        self.organization_result(&receipt, false)
    }
    fn organization_result(
        &self,
        r: &OrganizationReceipt,
        already_applied: bool,
    ) -> Result<Value, String> {
        Ok(
            json!({"moved":r.moved,"subtopicsUpdated":r.subtopics_updated,"recordsMoved":r.records_moved,"topicsCreated":r.topics_created,"retainedDependencyCount":r.retained_dependency_count,"backupId":r.backup_id,"stateHash":hash(&self.data)?,"alreadyApplied":already_applied}),
        )
    }
}
#[cfg(test)]
#[path = "records_organize_tests.rs"]
mod tests;
