//! Example thinker catalog and person-made links from records to thinkers.
//! The catalog holds only public, general information and is offered as an
//! example, not as a choice or a view. A link exists only when the person
//! creates it; nothing here infers a political identity.
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
/// The thinkers are examples only. Each idea carries its context: when it was
/// put forward and in answer to which events. "limits" states the limit of the
/// summary or a sourced criticism, never the editor's own view.
pub fn catalog() -> Value {
    json!({
        "version":2,
        "method":"Bir kaydı bir düşünüre yalnız sen bağlarsın. Bağlantı, o düşünürün bütün görüşlerini benimsediğin anlamına gelmez; Töre yakınlık puanı veya siyasi kimlik çıkarmaz.",
        "scope":"Bu katalogdaki düşünürler yalnız örnek olarak verilmiştir. Seçim bir sıralama, öneri ya da töre'nin görüşü değildir. Her fikrin yanında, hangi yıllarda ve hangi olaylar karşısında savunulduğu yazar.",
        "thinkers":[
            {"id":"gokalp","name":"Ziya Gökalp","years":"1876–1924",
             "works":["Türkleşmek, İslamlaşmak, Muasırlaşmak (1918)","Türkçülüğün Esasları (1923)"],
             "ideas":[
                {"text":"Millet soyla değil; dil, din, ahlak ve estetikte ortak eğitimle tanımlanır.",
                 "context":"Türkçülüğün Esasları'nda (Ankara, 1923) yazdı. Balkan Savaşları ve I. Dünya Savaşı'ndan sonra çok uluslu Osmanlı Devleti dağılmış, Ankara'da yeni bir devlet kuruluyordu; Gökalp o yıl Diyarbakır milletvekili oldu."},
                {"text":"Hars (millete özgü kültür) ile medeniyet (uluslararası teknik ve bilim) ayrımı.",
                 "context":"II. Meşrutiyet yıllarında (1908–1918) Batılılaşmanın nasıl olacağı tartışılırken dergi yazılarında geliştirdi; Türkleşmek, İslamlaşmak, Muasırlaşmak yazıları 1913'ten başlayarak Türk Yurdu'nda çıktı. Ayrım, Avrupa'nın bilim ve tekniğini alırken millî kültürü korumayı amaçlar."},
                {"text":"Tesanütçülük: toplumsal dayanışmayı sınıf çatışmasının önüne koyar.",
                 "context":"Durkheim sosyolojisinden etkilenerek, 1909'da girdiği İttihat ve Terakki merkez heyetinde bulunduğu yıllarda geliştirdi. Sınıf mücadelesini öne çıkaran sosyalist akımlara karşı meslek gruplarının dayanışmasını önerdi."}
             ],
             "criticisms":["İttihat ve Terakki yönetimindeki yeri nedeniyle dönemin homojenleştirme politikalarıyla bağı tartışılır.","Turancılık ve geçmişin idealleştirilmesi gerçekçi bulunmaz.","Tesanütçülüğün çıkar çatışmalarını görünmez kıldığı söylenir."],
             "limits":"Özet çoğunlukla 1918 ve 1923 kitaplarına dayanır. Gökalp'in görüşleri II. Meşrutiyet'ten Cumhuriyet'e uzanan savaş ve dağılma yıllarında değişti; erken yazılarındaki farklı vurgular burada yok."},
            {"id":"hegel","name":"G. W. F. Hegel","years":"1770–1831",
             "works":["Tinin Fenomenolojisi (1807)","Hukuk Felsefesinin İlkeleri (1820)"],
             "ideas":[
                {"text":"Bilinç ancak başka bir bilinç tarafından tanındığında kendini bilir.",
                 "context":"Tinin Fenomenolojisi'ni Jena'da bitirirken Napolyon'un ordusu 1806'da Prusya'yı Jena'da yenip kenti işgal etti; kitap 1807'de çıktı. Fransız Devrimi'nden sonra Alman felsefesinde özgürlük ve öz bilinç tartışmalarının içinde yazıldı."},
                {"text":"Efendi–köle diyalektiği: tek yönlü tanınma istikrarsızdır.",
                 "context":"Aynı kitabın (1807) öz bilinç bölümündedir. 1930'larda Kojève'in Paris'teki derslerinden sonra toplumsal çatışmanın ve tanınma mücadelesinin modeli olarak yaygın biçimde okundu."},
                {"text":"Devlet, özgürlüğün gerçekleştiği etik bütündür.",
                 "context":"Hukuk Felsefesinin İlkeleri'ni, 1818'den beri profesör olduğu Berlin'de, Napolyon savaşlarından sonraki Restorasyon döneminde yayımladı. 1819 Karlsbad Kararları üniversitelere sansür ve denetim getirmişti; Hegel kitapta anayasal monarşiyi savunur."}
             ],
             "criticisms":["Kierkegaard: sistem tek tek bireyi yutar.","Popper: otoriter devlet anlayışına düşünsel kaynak sağlar.","Marx: tarihi fikirler değil maddi koşullar belirler."],
             "limits":"Hegel'in devlet anlayışının nasıl okunacağı tartışmalıdır. Popper (Açık Toplum ve Düşmanları, 1945) onu otoriter devletin habercisi sayar; Avineri (Hegel's Theory of the Modern State, 1972) gibi yorumcular ise anayasal bir hukuk devleti tasarımı olarak okur."},
            {"id":"ibn-haldun","name":"İbn Haldun","years":"1332–1406",
             "works":["Mukaddime (1377)"],
             "ideas":[
                {"text":"Asabiyet: topluluğu bir arada tutan ve güç veren dayanışma.",
                 "context":"Mukaddime'yi 1377'de, bugünkü Cezayir'deki Kal'at İbn Selame'ye çekildiği yıllarda yazdı. Öncesinde Tunus, Fas, Tilimsan ve Gırnata'da birçok hükümdarın hizmetinde bulunmuş, kabile desteğiyle kurulan saltanatların el değiştirmesini yakından görmüştü."},
                {"text":"Rahatlık ve lüks asabiyeti zayıflatır.",
                 "context":"Mağrip'te kır ve çöl kökenli kabile birliklerinin şehirleri ele geçirip zamanla yerleşik saray hayatına geçtiği hanedanları örnek alarak savundu."},
                {"text":"Devletler çoğunlukla üç kuşakta yükselir ve çöker.",
                 "context":"Annesini, babasını ve bazı hocalarını 1348 veba salgınında yitirdi; Kuzey Afrika'da hanedanların sık sık değiştiği bir dönemde yazdı. Mukaddime'de salgının doğuda ve batıda şehirleri boşalttığını da anlatır."}
             ],
             "criticisms":["Döngü teorisi fazla deterministik bulunur.","Asabiyetin tanımı ve ölçümü belirsizdir.","İklimin insan karakterini belirlediğini söyleyen pasajları, bugün ırk ön yargısı taşıdığı gerekçesiyle eleştirilir."],
             "limits":"Kavramlarını 14. yüzyılda Kuzey Afrika ve Endülüs'teki kabile ve hanedan düzenini gözlemleyerek kurdu. Bunları modern uluslara ya da bugünkü devletlere uygulamak, sonraki yorumcuların yaptığı bir uyarlamadır."},
            {"id":"gellner","name":"Ernest Gellner","years":"1925–1995",
             "works":["Uluslar ve Ulusçuluk (1983)"],
             "ideas":[
                {"text":"Ulusçuluk, siyasi birim ile ulusal birimin örtüşmesi gerektiğini söyleyen siyasi bir ilkedir.",
                 "context":"Uluslar ve Ulusçuluk'u 1983'te, Londra'daki LSE'de profesörken yayımladı. Prag'da büyümüştü; ailesi 1939'da Hitler Almanyası'nın tehdidi yüzünden İngiltere'ye göç etti."},
                {"text":"Uluslar ulusçuluktan doğar; modern dünyanın ürünüdür.",
                 "context":"Ulusları kadim ve doğal varlıklar olarak anlatan ulusçu tarih yazımına karşı savundu. Aynı yıl Benedict Anderson (Hayali Cemaatler, 1983) ile Eric Hobsbawm ve Terence Ranger (Geleneğin İcadı, 1983) da ulusların modern olduğunu öne süren kitaplar yayımladı."},
                {"text":"Sanayi toplumu, kitlesel eğitimle yayılan standart bir dil gerektirir.",
                 "context":"Bu görüşü, sanayileşmenin okuryazar ve yer değiştirebilen bir iş gücü ile devlet eliyle kitlesel eğitim gerektirdiği tezine dayandırır. Örnekleri ağırlıkla 19. ve 20. yüzyıl Avrupa'sının sanayileşmesinden ve imparatorlukların dağılmasından gelir."}
             ],
             "criticisms":["İşlevselcidir; ulusçuluğun duygusal gücünü açıklamaz.","Etno-sembolcüler: ulusların modern öncesi etnik kökleri vardır.","Sanayileşmemiş toplumlardaki ulusçulukları açıklamakta zorlanır."],
             "limits":"Gellner ulusçuluğu savunmak ya da reddetmek için değil, açıklamak için yazar. Özet kuramı 1983 kitabındaki hâliyle verir; sonraki kitaplarındaki (Encounters with Nationalism, 1994; Nationalism, 1997) tartışmalar burada yok."},
            {"id":"weber","name":"Max Weber","years":"1864–1920",
             "works":["Protestan Ahlakı ve Kapitalizmin Ruhu (1905)","Bir Meslek Olarak Siyaset (1919)","Ekonomi ve Toplum (ölümünden sonra, 1921–1922)"],
             "ideas":[
                {"text":"Devlet, belirli bir toprak üzerinde meşru fiziksel şiddet tekelini elinde tutan topluluktur.",
                 "context":"Bir Meslek Olarak Siyaset'i 28 Ocak 1919'da Münih'te öğrencilere konferans olarak verdi. Almanya I. Dünya Savaşı'nı kaybetmiş, 1918–1919 devrimiyle imparatorluk yıkılmıştı."},
                {"text":"Geleneksel, karizmatik ve yasal-ussal meşruiyet.",
                 "context":"Bu ayrımı, ölümünden sonra yayımlanan Ekonomi ve Toplum için farklı çağ ve toplumları karşılaştırdığı çalışmalarda geliştirdi; 1919 konferansında da kısaca anlattı."},
                {"text":"İnanç etiği ile sorumluluk etiği ayrımı.",
                 "context":"Aynı 1919 konferansındadır. Devrim ortamında yalnız ilkelerine göre davranan siyasetçilere karşı, eylemin sonuçlarının sorumluluğunu da almayı savundu; ona göre siyasetçi iki etiği birlikte taşımalıdır."}
             ],
             "criticisms":["Meşruiyet kavramı betimleyicidir; kabul edilen her baskıyı meşru sayma riski taşır.","Çöken devletlerde tekel tanımı işlemez.","Güçlü başkanlık savunusu Weimar'daki olağanüstü hal yetkilerinin önünü açmakla eleştirilir."],
             "limits":"Weber meşruiyet türlerini, gerçekte saf hâlde bulunmayan karşılaştırma araçları ('ideal tip') olarak sunar. Özet 1919 konferansına ve Ekonomi ve Toplum'a dayanır; Weimar Anayasası tartışmasındaki yazıları burada yok."},
            {"id":"hobbes","name":"Thomas Hobbes","years":"1588–1679",
             "works":["Leviathan (1651)"],
             "ideas":[
                {"text":"Devletsiz doğa durumu herkesin herkese karşı savaşıdır.",
                 "context":"Leviathan'ı İngiliz İç Savaşı (1642–1651) yıllarında, kralcılara yakınlığı yüzünden 1640'ta gittiği Paris'te yazdı; kitap 1651'de Londra'da çıktı. 13. bölüm, ortak bir gücün olmadığı yaşamı iç savaşa düşen toplumlarla karşılaştırır."},
                {"text":"Toplum sözleşmesi: güvenlik karşılığında hakların egemene devri.",
                 "context":"Egemenliği kralın tanrısal hakkına değil, insanların güvenlik için yaptığı sözleşmeye dayandırdı. Kitap, 1649'da Kral I. Charles'ın idamından sonra yeni yönetime bağlılığın tartışıldığı yıllarda çıktı."},
                {"text":"Egemenlik mutlak ve bölünmezdir; kendini koruma hakkı devredilemez.",
                 "context":"18. bölümde, İngiltere'de iç savaşın yetkilerin kral, Lordlar ve Avam Kamarası arasında bölündüğü inancından çıktığını yazar. 21. bölüme göre uyruğun bağlılığı, egemen onu koruyabildiği sürece sürer."}
             ],
             "criticisms":["Locke: mutlak egemen yeni bir tehlikedir.","Rousseau: toplumun bozduğu insanı doğaya yansıtır.","İnsan doğası hakkındaki karamsarlığı iş birliği kanıtlarıyla sorgulanır."],
             "limits":"Hobbes doğa durumunu tarihsel bir dönem olarak değil, egemenliğin gerekçesi olarak kurar; böyle bir durumun bütün dünyada genel olarak yaşanmadığını kendisi yazar (Leviathan, 13. bölüm). Örnekleri 17. yüzyıl İngiltere'sinden ve Avrupalıların o dönemki Amerika anlatılarından gelir."},
            {"id":"fichte","name":"J. G. Fichte","years":"1762–1814",
             "works":["Bilim Öğretisi (1794)","Kapalı Ticaret Devleti (1800)","Alman Ulusuna Söylevler (1807–1808)"],
             "ideas":[
                {"text":"Ulusun özü dildir.",
                 "context":"Alman Ulusuna Söylevler'i 1807–1808 kışında, Fransız işgali altındaki Berlin'de halka açık konferanslar olarak verdi. Napolyon 1806'da Prusya'yı yenmiş, Kutsal Roma İmparatorluğu dağılmıştı; Almanca konuşanların ortak bir devleti yoktu."},
                {"text":"Kesintisiz yaşayan bir 'kök dil' fikri.",
                 "context":"Aynı konferanslarda Almanları, Latin kökenli bir dili benimseyen öbür Germen halklarından ayırır: Almanlar kendi kök dillerini sürdürmüştür. Bu ayrım, Fransız egemenliği altındaki Almanca konuşanlara ortak bir kimlik önerme bağlamında yapılır."},
                {"text":"Ulusal eğitimle yeni bir kuşak yetiştirme.",
                 "context":"Prusya'nın 1806 yenilgisinden sonra devletin ve toplumun nasıl yenileneceği tartışılırken Pestalozzi'nin yöntemine dayanan bir ulusal eğitim önerdi. 1810'da açılan Berlin Üniversitesi'nin ilk seçilmiş rektörü oldu."}
             ],
             "criticisms":["Şovenizmin ve ulusal üstünlük fikrinin kaynaklarından sayılır.","1793 tarihli bir metninde Yahudilere yönelik ağır düşmanca ifadeler vardır.","Bazı araştırmacılar Söylevler'in kozmopolit bir eğitim projesi olarak çarpıtıldığını savunur."],
             "limits":"Söylevler, Fransız işgali altında yaşayan ve ortak bir devleti olmayan Almanca konuşanlara seslenir. Metin 19. ve 20. yüzyılda farklı ulusçu hareketlerce kendi amaçlarına göre yorumlandı; bu özet 1807–1808 bağlamını anlatır."},
            {"id":"schmitt","name":"Carl Schmitt","years":"1888–1985",
             "works":["Siyasi İlahiyat (1922)","Parlamenter Demokrasinin Krizi (1923)","Siyasal Kavramı (1927/1932)"],
             "ideas":[
                {"text":"Siyasi olanın ölçütü dost ile düşman ayrımıdır.",
                 "context":"Siyasal Kavramı'nı Weimar Cumhuriyeti'nde 1927'de makale, 1932'de kitap olarak yayımladı. Ekonomik kriz, sokak çatışmaları ve parlamentoda çoğunluk kurulamaması cumhuriyeti sarsıyordu; Schmitt liberalizmin siyasal çatışmayı ekonomi ve tartışmayla ortadan kaldıramayacağını savundu."},
                {"text":"Egemen, olağanüstü hale karar verendir.",
                 "context":"Siyasi İlahiyat'ın (1922) ilk cümlesidir. Savaş sonrası ayaklanmalar ve darbe girişimleri karşısında Weimar Anayasası'nın 48. maddesindeki olağanüstü hal yetkilerinin sık kullanıldığı yıllarda yazıldı; Schmitt bu yetkileri geniş yorumladı."},
                {"text":"Demokrasi homojenlik ister.",
                 "context":"Parlamenter Demokrasinin Krizi'nin 1926 baskısına eklediği önsözde, Richard Thoma'nın eleştirisine yanıt olarak yazdı. Liberal parlamentarizm ile demokrasiyi ayırır ve demokrasinin önce türdeşlik, gerekirse türdeş olmayanın ayıklanmasını gerektirdiğini yazar."}
             ],
             "criticisms":["1933'te Nazi Partisi'ne katıldı; rejimin hukukçusu oldu ve geçmişiyle yüzleşmedi.","Homojenlik uğruna heterojen olanın ayıklanmasını savundu.","Habermas onu liberal demokrasinin en tehlikeli eleştirmenlerinden sayar."],
             "limits":"Özet kavramları Weimar Cumhuriyeti'nin 1919–1933 krizleri içinde verir. Sonraki yazarlar onları dönüştürerek kullanır: örneğin Chantal Mouffe (On the Political, 2005) 'düşman' yerine varlık hakkı tanınan meşru 'hasım' kavramını önerir."}
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
        assert!(cat["scope"].as_str().unwrap().contains("örnek"));
        for t in items {
            for key in ["name", "years", "limits"] {
                assert!(!t[key].as_str().unwrap().is_empty());
            }
            for key in ["works", "ideas", "criticisms"] {
                assert!(!t[key].as_array().unwrap().is_empty());
            }
            // Every idea says when and in answer to which events it was put forward.
            for idea in t["ideas"].as_array().unwrap() {
                for key in ["text", "context"] {
                    assert!(!idea[key].as_str().unwrap().is_empty());
                }
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
