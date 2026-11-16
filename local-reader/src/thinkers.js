/* Töre 0.2.0 — kaynakları geliştirme sırasında okunmuş başlangıç derlemeleri.
   Otomatik kayıt veya ağ erişimi yapmaz. Kullanıcı açıkça eklerse düzenlenebilir
   bir profil kopyası oluşturulur. Metinler doğrudan alıntı değildir. */
(() => {
  'use strict';
  globalThis.ToreThinkers = [
    {
      kind: 'thinker',
      name: 'Karl Marx',
      bio: 'Gotha Programı’nın Eleştirisi’nin yazarı. Bu küçük derleme, 1875 tarihli metnin kendi bağlamındaki gelecek tasarımını ele alır; Marx adına günümüz dünyasına ilişkin görüş üretmez.',
      editor: 'Töre kaynaklı başlangıç derlemesi',
      sources: [
        {label: 'Gotha Programı’nın Eleştirisi (1875), Bölüm I — Marxists Internet Archive', url: 'https://www.marxists.org/archive/marx/works/1875/gotha/ch01.htm', reportId: ''}
      ],
      views: [
        {
          topic: 'İhtiyaçlara göre dağıtımın koşulları',
          area: 'future',
          kind: 'position',
          text: '1875 tarihli metinde Marx, komünist toplumun daha yüksek aşamasında ihtiyaçları esas alan dağıtımı; bireyin gelişimi, işbölümüne bağımlılığın aşılması ve üretkenliğin artması gibi koşullara bağlar. Bu kayıt, metindeki koşullu gelecek tasarımının özetidir; gerçekleşme tarihi verilmiş bir tahmin değildir.',
          bridge: '',
          sourceIndexes: [0]
        }
      ]
    },
    {
      kind: 'thinker',
      name: 'Adam Smith',
      bio: 'Ulusların Zenginliği’nin yazarı. Buradaki kayıtlar metnin tarihsel ticaret toplumu çözümlemesidir; “Bugün” alanı Smith’in kendi dönemine ilişkindir ve bugünün dünyasına atfedilen bir görüş değildir.',
      editor: 'Töre kaynaklı başlangıç derlemesi',
      sources: [
        {label: 'Ulusların Zenginliği, Kitap I Bölüm I: İşbölümü — Project Gutenberg', url: 'https://www.gutenberg.org/files/3300/3300-h/3300-h.htm', reportId: ''},
        {label: 'Ulusların Zenginliği, Kitap V Bölüm I: Halkın eğitimi — Project Gutenberg', url: 'https://www.gutenberg.org/files/3300/3300-h/3300-h.htm', reportId: ''}
      ],
      views: [
        {
          topic: 'İşbölümü ve üretkenlik',
          area: 'present',
          kind: 'position',
          text: 'Smith, kendi döneminin üretimini ele alırken işbölümünün beceriyi artırması, işler arasındaki zaman kaybını azaltması ve makinelerin gelişimini kolaylaştırması yoluyla üretkenliği yükseltebildiğini savunur. Bu, Ulusların Zenginliği Kitap I Bölüm I’in tarihsel çözümlemesidir; günümüz için ayrıca doğrulanmış bir sonuç değildir.',
          bridge: '',
          sourceIndexes: [0]
        },
        {
          topic: 'Tekrarlı iş ve eğitim',
          area: 'present',
          kind: 'position',
          text: 'Kitap V’te Smith, yaşamı az sayıda basit işle sınırlanan emekçinin düşünme ve buluş yetilerini kullanma fırsatının daralabileceğini belirtir; halk eğitiminin kamusal desteğini tartışır. Bu kayıt, aynı tarihsel metindeki işbölümü eleştirisidir; düşünür adına güncel eğitim politikası önermez.',
          bridge: '',
          sourceIndexes: [1]
        }
      ]
    }
  ];
})();
