//! Editorial thinker catalog and person-made links from records to thinkers.
//! The catalog holds only public, general information. A link exists only when
//! the person creates it; nothing here infers a political identity.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThinkerLink {
    pub id: String,
    pub thinker_id: String,
    pub record_id: String,
    pub note: String,
    pub created_at: String,
    pub creation_request_hash: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LinkInput {
    request_id: Option<String>,
    thinker_id: String,
    record_id: String,
    #[serde(default)]
    note: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnlinkInput {
    link_id: String,
    confirmed_by_user: bool,
}

const MAX_LINKS: usize = 3000;

/// Deliberately small, versioned and editorial. Not a ranking or a scale.
pub fn catalog() -> Value {
    json!({
        "version":1,
        "method":"Bir kaydı bir düşünüre yalnız sen bağlarsın. Bağlantı, o düşünürün bütün görüşlerini benimsediğin anlamına gelmez; Töre yakınlık puanı veya siyasi kimlik çıkarmaz.",
        "thinkers":[
            {"id":"gokalp","name":"Ziya Gökalp","years":"1876–1924",
             "works":["Türkleşmek, İslamlaşmak, Muasırlaşmak (1918)","Türkçülüğün Esasları (1923)"],
             "ideas":["Millet soyla değil; dil, din, ahlak ve estetikte ortak eğitimle tanımlanır.","Hars (millete özgü kültür) ile medeniyet (uluslararası teknik ve bilim) ayrımı.","Tesanütçülük: toplumsal dayanışmayı sınıf çatışmasının önüne koyar."],
             "criticisms":["İttihat ve Terakki yönetimindeki yeri nedeniyle dönemin homojenleştirme politikalarıyla bağı tartışılır.","Turancılık ve geçmişin idealleştirilmesi gerçekçi bulunmaz.","Tesanütçülüğün çıkar çatışmalarını görünmez kıldığı söylenir."],
             "limits":"Kültürel birlik vurgusu, belirli bir hukuk veya devlet programını kendiliğinden içermez."},
            {"id":"hegel","name":"G. W. F. Hegel","years":"1770–1831",
             "works":["Tinin Fenomenolojisi (1807)","Hukuk Felsefesinin İlkeleri (1820)"],
             "ideas":["Bilinç ancak başka bir bilinç tarafından tanındığında kendini bilir.","Efendi–köle diyalektiği: tek yönlü tanınma istikrarsızdır.","Devlet, özgürlüğün gerçekleştiği etik bütündür."],
             "criticisms":["Kierkegaard: sistem tek tek bireyi yutar.","Popper: otoriter devlet anlayışına düşünsel kaynak sağlar.","Marx: tarihi fikirler değil maddi koşullar belirler."],
             "limits":"Hegel'in devleti dil veya soy topluluğu değil, akla dayalı bir hukuk düzenidir; romantik milliyetçiliğe karşı çıkmıştır."},
            {"id":"ibn-haldun","name":"İbn Haldun","years":"1332–1406",
             "works":["Mukaddime (1377)"],
             "ideas":["Asabiyet: topluluğu bir arada tutan ve güç veren dayanışma.","Rahatlık ve lüks asabiyeti zayıflatır.","Devletler çoğunlukla üç kuşakta yükselir ve çöker."],
             "criticisms":["Döngü teorisi fazla deterministik bulunur.","Asabiyetin tanımı ve ölçümü belirsizdir.","İklim determinizmi içeren pasajlar bugün ırkçı sayılır."],
             "limits":"Asabiyetin kökü kan bağıdır; himaye yoluyla genişler ama dil ölçüt değildir."},
            {"id":"gellner","name":"Ernest Gellner","years":"1925–1995",
             "works":["Uluslar ve Ulusçuluk (1983)"],
             "ideas":["Ulusçuluk, siyasi birim ile ulusal birimin örtüşmesi gerektiğini söyleyen siyasi bir ilkedir.","Uluslar ulusçuluktan doğar; modern dünyanın ürünüdür.","Sanayi toplumu, kitlesel eğitimle yayılan standart bir dil gerektirir."],
             "criticisms":["İşlevselcidir; ulusçuluğun duygusal gücünü açıklamaz.","Etno-sembolcüler: ulusların modern öncesi etnik kökleri vardır.","Sanayileşmemiş toplumlardaki ulusçulukları açıklamakta zorlanır."],
             "limits":"Gellner ulusçuluğu savunmaz, çözümler."},
            {"id":"weber","name":"Max Weber","years":"1864–1920",
             "works":["Protestan Ahlakı ve Kapitalizmin Ruhu (1905)","Bir Meslek Olarak Siyaset (1919)","Ekonomi ve Toplum"],
             "ideas":["Devlet, belirli bir toprak üzerinde meşru fiziksel şiddet tekelini elinde tutan topluluktur.","Geleneksel, karizmatik ve yasal-ussal meşruiyet.","İnanç etiği ile sorumluluk etiği ayrımı."],
             "criticisms":["Meşruiyet kavramı betimleyicidir; kabul edilen her baskıyı meşru sayma riski taşır.","Çöken devletlerde tekel tanımı işlemez.","Güçlü başkanlık savunusu Weimar'daki olağanüstü hal yetkilerinin önünü açmakla eleştirilir."],
             "limits":"Weber neyin meşru kabul edildiğini betimler, neyin meşru olması gerektiğini söylemez."},
            {"id":"hobbes","name":"Thomas Hobbes","years":"1588–1679",
             "works":["Leviathan (1651)"],
             "ideas":["Devletsiz doğa durumu herkesin herkese karşı savaşıdır.","Toplum sözleşmesi: güvenlik karşılığında hakların egemene devri.","Egemenlik mutlak ve bölünmezdir; kendini koruma hakkı devredilemez."],
             "criticisms":["Locke: mutlak egemen yeni bir tehlikedir.","Rousseau: toplumun bozduğu insanı doğaya yansıtır.","İnsan doğası hakkındaki karamsarlığı iş birliği kanıtlarıyla sorgulanır."],
             "limits":"Sözleşme bireyler arasıdır ve yalnız güvenlikle ilgilidir; dil veya kültür içermez. Doğa durumunda sözünü ilk yerine getireni akılsız bulur."},
            {"id":"fichte","name":"J. G. Fichte","years":"1762–1814",
             "works":["Bilim Öğretisi (1794)","Kapalı Ticaret Devleti (1800)","Alman Ulusuna Söylevler (1807–1808)"],
             "ideas":["Ulusun özü dildir.","Kesintisiz yaşayan bir 'kök dil' fikri.","Ulusal eğitimle yeni bir kuşak yetiştirme."],
             "criticisms":["Şovenizmin ve ulusal üstünlük fikrinin kaynaklarından sayılır.","1793 tarihli bir metninde Yahudilere yönelik ağır düşmanca ifadeler vardır.","Bazı araştırmacılar Söylevler'in kozmopolit bir eğitim projesi olarak çarpıtıldığını savunur."],
             "limits":"Dilleri hiyerarşik sıralar; dil sonradan kolayca kazanılan bir şey olarak görülmez."},
            {"id":"schmitt","name":"Carl Schmitt","years":"1888–1985",
             "works":["Siyasi İlahiyat (1922)","Parlamenter Demokrasinin Krizi (1923)","Siyasal Kavramı (1927/1932)"],
             "ideas":["Siyasi olanın ölçütü dost ile düşman ayrımıdır.","Egemen, olağanüstü hale karar verendir.","Demokrasi homojenlik ister."],
             "criticisms":["1933'te Nazi Partisi'ne katıldı; rejimin hukukçusu oldu ve geçmişiyle yüzleşmedi.","Homojenlik uğruna heterojen olanın ayıklanmasını savundu.","Habermas onu liberal demokrasinin en tehlikeli eleştirmenlerinden sayar."],
             "limits":"Chantal Mouffe'un agonistik çoğulculuğu 'düşmanı' varlık hakkı tanınan meşru bir 'hasım'a dönüştürür."}
        ]
    })
}

fn known_thinkers() -> BTreeSet<String> {
    catalog()["thinkers"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|t| t["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn validate_links(s: &Store) -> Result<(), String> {
    if s.thinker_links.len() > MAX_LINKS {
        return Err("Düşünür bağlantısı sınırı aşıldı".into());
    }
    let known = known_thinkers();
    let mut pairs = BTreeSet::new();
    for (id, link) in &s.thinker_links {
        if id != &link.id
            || !known.contains(&link.thinker_id)
            || !s.records.contains_key(&link.record_id)
            || !bounded(&link.note, 2000, false)
            || !pairs.insert((link.thinker_id.clone(), link.record_id.clone()))
        {
            return Err("Düşünür bağlantısı geçersiz".into());
        }
    }
    Ok(())
}

impl Disk {
    pub fn thinkers_view(&self) -> Result<Value, String> {
        self.check()?;
        let links: Vec<Value> = self
            .data
            .thinker_links
            .values()
            .filter(|l| self.data.records[&l.record_id].trashed_at.is_none())
            .map(|l| {
                let r = &self.data.records[&l.record_id];
                json!({"link":l,"record":{"id":r.id,"topicId":r.topic_id,"kind":r.kind,"text":r.text,
                    "attribution":r.attribution,"review":r.review,"adoption":r.adoption,"currency":r.currency}})
            })
            .collect();
        Ok(json!({"catalog":catalog(),"links":links,"stateHash":hash(&self.data)?}))
    }

    pub fn thinker_link(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: LinkInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Bağlantı yalnız açık onayla kurulur".into());
        }
        if !known_thinkers().contains(&r.thinker_id) {
            return Err("Düşünür katalogda yok".into());
        }
        if !self
            .data
            .records
            .get(&r.record_id)
            .is_some_and(|x| x.trashed_at.is_none())
        {
            return Err("Kayıt bulunamadı".into());
        }
        if !bounded(&r.note, 2000, false) {
            return Err("Not çok uzun veya geçersiz".into());
        }
        let id = request_id(r.request_id.as_deref())?;
        let request_hash = hash(&r)?;
        if let Some(existing) = self.data.thinker_links.get(&id) {
            if existing.creation_request_hash != request_hash {
                return Err("İstek kimliği başka içerik için kullanılmış".into());
            }
            return Ok(json!({"link":existing}));
        }
        if self
            .data
            .thinker_links
            .values()
            .any(|l| l.thinker_id == r.thinker_id && l.record_id == r.record_id)
        {
            return Err("Bu kayıt bu düşünüre zaten bağlı".into());
        }
        let link = ThinkerLink {
            id,
            thinker_id: r.thinker_id,
            record_id: r.record_id,
            note: r.note,
            created_at: now(),
            creation_request_hash: request_hash,
        };
        let mut next = self.data.clone();
        next.thinker_links.insert(link.id.clone(), link.clone());
        self.commit(next)?;
        Ok(json!({"link":link}))
    }

    pub fn thinker_unlink(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: UnlinkInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Bağlantı yalnız açık onayla kaldırılır".into());
        }
        if !self.data.thinker_links.contains_key(&r.link_id) {
            return Err("Bağlantı bulunamadı".into());
        }
        let mut next = self.data.clone();
        next.thinker_links.remove(&r.link_id);
        self.commit(next)?;
        Ok(json!({"removed":r.link_id}))
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
            .join(format!("tore-thinkers-{}", id()))
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
        let r = d
            .record_create(
                json!({"topicId":t,"kind":"opinion","text":"Yapay görüş","reason":""}),
                &BTreeMap::new(),
            )
            .unwrap()["record"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        (path, d, r)
    }

    #[test]
    fn catalog_ids_are_unique_and_complete() {
        let cat = catalog();
        let items = cat["thinkers"].as_array().unwrap();
        assert_eq!(items.len(), 8);
        assert_eq!(known_thinkers().len(), 8);
        for t in items {
            for key in ["name", "years", "limits"] {
                assert!(!t[key].as_str().unwrap().is_empty());
            }
            for key in ["works", "ideas", "criticisms"] {
                assert!(!t[key].as_array().unwrap().is_empty());
            }
        }
    }

    #[test]
    fn link_requires_consent_known_thinker_and_existing_record() {
        let (path, mut d, r) = setup();
        let base = json!({"thinkerId":"hegel","recordId":r,"confirmedByUser":false});
        assert!(d.thinker_link(base.clone()).is_err());
        assert!(
            d.thinker_link(json!({"thinkerId":"nobody","recordId":r,"confirmedByUser":true}))
                .is_err()
        );
        assert!(
            d.thinker_link(
                json!({"thinkerId":"hegel","recordId":"missing","confirmedByUser":true})
            )
            .is_err()
        );
        assert!(
            d.thinker_link(
                json!({"thinkerId":"hegel","recordId":r,"confirmedByUser":true,"extra":1})
            )
            .is_err()
        );
        assert!(
            d.thinkers_view().unwrap()["links"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn link_is_idempotent_unique_persistent_and_removable() {
        let (path, mut d, r) = setup();
        let rid = uuid::Uuid::new_v4().to_string();
        let input = json!({"requestId":rid,"thinkerId":"gokalp","recordId":r,"note":"Yakın buluyorum","confirmedByUser":true});
        let first = d.thinker_link(input.clone()).unwrap();
        assert_eq!(d.thinker_link(input).unwrap(), first);
        assert!(
            d.thinker_link(
                json!({"requestId":rid,"thinkerId":"hegel","recordId":r,"confirmedByUser":true})
            )
            .is_err()
        );
        assert!(
            d.thinker_link(json!({"thinkerId":"gokalp","recordId":r,"confirmedByUser":true}))
                .is_err()
        );
        drop(d);
        let mut d = Disk::open(path.clone()).unwrap();
        let view = d.thinkers_view().unwrap();
        assert_eq!(view["links"][0]["record"]["text"], "Yapay görüş");
        assert_eq!(view["links"][0]["link"]["note"], "Yakın buluyorum");
        let link_id = first["link"]["id"].as_str().unwrap();
        assert!(
            d.thinker_unlink(json!({"linkId":link_id,"confirmedByUser":false}))
                .is_err()
        );
        d.thinker_unlink(json!({"linkId":link_id,"confirmedByUser":true}))
            .unwrap();
        assert!(
            d.thinkers_view().unwrap()["links"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        fs::remove_dir_all(path).ok();
    }

    #[test]
    fn empty_links_keep_existing_store_bytes_compatible() {
        let (path, d, _) = setup();
        let bytes = fs::read(path.join("records-v1.json")).unwrap();
        assert!(!String::from_utf8(bytes).unwrap().contains("thinkerLinks"));
        drop(d);
        fs::remove_dir_all(path).ok();
    }
}
