// Local, offline rule suggestions for dream reports. They are only suggestions: nothing
// becomes a dataset label until the user confirms it on the dream screen.
// Words of 4+ letters match as prefixes (Turkish suffixes); shorter words match exactly.
// Entries with a space match as phrases anywhere in the text.
export const LEXICON = {
 characters: {
  family: ['anne','baba','kardeş','abla','abi','ağabey','dede','nine','teyze','hala','amca','dayı','dayım','kuzen','aile','oğlum','kızım','yeğen','torun'],
  partner: ['sevgili','eşim','eşimle','karım','kocam','nişanlı','partner'],
  friend: ['arkadaş','dost'],
  known_person: ['patron','müdür','öğretmen','hoca','komşu','ünlü','meslektaş','tanıdık'],
  stranger: ['yabancı','tanımadığım','adam','kadın','biri','birisi','kalabalık','insanlar'],
  child: ['çocuk','bebek'],
  animal: ['köpek','kedi','kuş','kuşlar','kuşu','at','atı','ata','yılan','balık','aslan','kurt','örümcek','böcek','hayvan','fare','ayı','ayıyı'],
  creature: ['canavar','hayalet','cin','cinler','şeytan','zombi','yaratık','uzaylı','gölge'],
 },
 emotions: {
  fear: ['kork','kaygı','endişe','panik','dehşet','ürkt','telaş','ödüm'],
  joy: ['mutlu','sevin','neşe','güldü','gülüy','keyif','coşku','heyecanl'],
  sadness: ['üzgün','üzül','ağla','hüzün','keder','yalnız','özle'],
  anger: ['öfke','kızdı','kızgın','sinirl','sinirlen','bağır','kavga'],
  confusion: ['kafam karış','karışık','anlamad','anlayamad','tuhaf','garip','saçma'],
  shame: ['utan','mahcup','rezil','çıplak'],
  surprise: ['şaşır','şaşkın','birden','aniden','beklemed'],
  calm: ['huzur','sakin','rahat','dingin','sessiz'],
 },
 settings: {
  home: ['ev','eve','evi','evde','evden','evim','evimiz','evimizde','evimde','oda','odada','odamda','odası','salon','mutfak','yatak','balkon'],
  school_work: ['okul','sınıf','ofis','iş yeri','işyeri','toplantı','sınav','üniversite','fakülte','şirket'],
  city: ['sokak','cadde','şehir','kent','çarşı','pazar','market','meydan','bina'],
  nature: ['orman','dağ','dağa','dağda','dağın','dağı','bahçe','tarla','çöl','ağaç','park','çimen','kır'],
  water: ['deniz','göl','nehir','okyanus','havuz','sahil','plaj','yüzüyor','yüzdü','yüzme','dalga','sular'],
  vehicle: ['araba','otobüs','tren','uçak','gemi','vapur','metro','taksi','motosiklet','bisiklet','asansör'],
  unfamiliar_place: ['bilmediğim bir yer','tanımadığım bir yer','garip bir yer','yabancı bir yer','hiç görmediğim'],
 },
 themes: {
  lucid: ['rüya olduğunu','rüyada olduğumu','rüya gördüğümü','rüyada olduğunu'],
  nightmare: ['kabus'],
  recurring: ['yine aynı','tekrar aynı','her zamanki','hep gördüğüm','yine o'],
  flying: ['uçuy','uçtu','uçabil','uçmaya','havada süzül'],
  falling: ['düştü','düşüyor','düşecek','düşmek','boşluğa'],
  chased: ['kovala','peşimde','peşimden','kaçıy','kaçtı','kaçmaya'],
  lost: ['kaybol','yolumu bul','yolumu kaybet','kayıp'],
  late: ['geç kal','yetişemi','yetişemed','kaçırd'],
 },
};
export const LABELS = {
 family:'Aile',partner:'Partner',friend:'Arkadaş',known_person:'Tanıdık',stranger:'Yabancı',child:'Çocuk',animal:'Hayvan',creature:'Yaratık',
 fear:'Korku',joy:'Sevinç',sadness:'Üzüntü',anger:'Öfke',confusion:'Kafa karışıklığı',shame:'Utanç',surprise:'Şaşkınlık',calm:'Huzur',
 home:'Ev',school_work:'Okul / iş',city:'Şehir',nature:'Doğa',water:'Su',vehicle:'Taşıt',unfamiliar_place:'Bilinmeyen yer',
 lucid:'Berrak rüya',nightmare:'Kâbus',recurring:'Tekrarlayan',flying:'Uçmak',falling:'Düşmek',chased:'Kovalanmak',lost:'Kaybolmak',late:'Geç kalmak',
};
export const GROUPS = {characters:'Karakterler',emotions:'Duygular',settings:'Mekânlar',themes:'Temalar'};

const fold = text => text.normalize('NFC').toLocaleLowerCase('tr-TR');
const tokens = text => fold(text).split(/[^\p{L}]+/u).filter(Boolean);
function hit(entry, words, folded){
 if(entry.includes(' '))return folded.includes(entry);
 return entry.length>=4?words.some(w=>w.startsWith(entry)):words.includes(entry);
}
/** Suggest codes: {characters:[...], emotions:[...], settings:[...], themes:[...]} */
export function suggest(text){
 const folded=fold(text), words=tokens(text), out={};
 for(const [group,codes] of Object.entries(LEXICON))out[group]=Object.entries(codes).filter(([,entries])=>entries.some(e=>hit(e,words,folded))).map(([code])=>code);
 if(nameCandidates(text).length&&!out.characters.includes('known_person'))out.characters.push('known_person');
 return out;
}

const COMMON = new Set(['Sonra','Ama','Ve','Bir','Bu','O','Ben','Biz','Rüyada','Rüyamda','Birden','Aniden','Ardından','Daha','Sanki','Hatta','Yine','Orada','Şimdi','Tanrı','Allah']);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Capitalised words that are not at a sentence start: likely names of people or places. */
export function nameCandidates(text){
 const found=new Set();
 const re=/(^|[.!?…]\s*|\s)([\p{Lu}][\p{L}]+)/gu;let m;
 while((m=re.exec(text))){
  const start=m.index===0&&m[1]===''||/[.!?…]/.test(m[1]);
  if(!start&&!COMMON.has(m[2]))found.add(m[2]);
 }
 // A word that appears capitalised mid-sentence once is a candidate everywhere.
 return [...found];
}
/** Replace every whole-word occurrence (keeping Turkish suffixes after an apostrophe). */
export function replaceName(text,name,token){
 return text.replace(new RegExp(`(?<!\\p{L})${escape(name)}(?!\\p{L})`,'gu'),token);
}
/** Automatic masking of patterns that are never part of a dream's meaning. */
export function maskPatterns(text){
 return text
  .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi,'[E-POSTA]')
  .replace(/(?:\+\d[\d ()\-]{7,}\d|\b\d{10,15}\b)/g,'[TELEFON]');
}
