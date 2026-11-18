// Interface language for every töre page (English and Turkish).
// A classic script, loaded before the page dictionaries and page modules. It
// only changes interface text; the person's own records are never translated.
// The saved choice lives with the notebook on this computer (ui-language-get /
// ui-language-set), because the loopback port and so the browser origin change
// on every launch.
(() => {
  'use strict';
  const LANGS = ['en', 'tr'];
  const LOCALES = { en: 'en-GB', tr: 'tr-TR' };
  const dict = Object.create(null);
  const serverText = Object.create(null);
  const listeners = [];
  const guards = [];
  let caller = null;
  let ready = null;
  // Resolves once the saved language is known, whoever asked for it first.
  let settle;
  const settled = new Promise(resolve => { settle = resolve; });
  const valid = value => (LANGS.includes(value) ? value : null);
  // No saved choice: Turkish browsers get Turkish, everyone else English.
  const fromNavigator = () => (/^tr\b/i.test(String((typeof navigator !== 'undefined' && navigator.language) || '')) ? 'tr' : 'en');
  // Until the saved choice arrives the page keeps its Turkish HTML, so nothing is blank.
  let lang = 'tr';

  // Entries are { key: [turkish, english] }. A value may be a string or a plural
  // object such as { one: '{n} record', other: '{n} records' }.
  function add(entries) {
    for (const [key, value] of Object.entries(entries)) {
      if (!Array.isArray(value) || value.length !== 2) throw Error('i18n: ' + key + ' needs [tr, en]');
      dict[key] = value;
    }
  }
  // Service messages from the local server, keyed by their exact Turkish text.
  function addServer(entries) { Object.assign(serverText, entries); }
  const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match)) : String(text));
  function form(value, count) {
    if (value && typeof value === 'object') {
      let rule = 'other';
      try { rule = new Intl.PluralRules(LOCALES[lang]).select(count); } catch { rule = count === 1 ? 'one' : 'other'; }
      return value[rule] ?? value.other;
    }
    return value;
  }
  function t(key, vars) {
    const entry = dict[key];
    if (!entry) { if (typeof console !== 'undefined') console.warn('i18n: missing key ' + key); return key; }
    const value = entry[lang === 'tr' ? 0 : 1];
    // Without a count (static HTML before data arrives) a plural reads as plural.
    if (!(vars && typeof vars.n === 'number')) return fill(value && typeof value === 'object' ? value.other : value, vars);
    return fill(form(value, vars.n), vars);
  }
  // Counts: Turkish keeps the noun singular after a number, English does not.
  const n = (key, count, vars) => t(key, { ...(vars || {}), n: count });
  const has = key => Object.prototype.hasOwnProperty.call(dict, key);
  // Exact service message → this language; unknown messages stay as they are.
  function server(message) {
    const text = String(message ?? '').trim();
    if (lang !== 'en') return text;
    return serverText[text] || serverText[text.replace(/\.$/, '')] || text;
  }

  // A tiny, safe subset of inline markup for translated sentences that carry
  // emphasis. Everything else is text.
  const RICH = /<(\/?)(b|strong|em|i|kbd|code|br)>/g;
  function rich(el, text) {
    const doc = el.ownerDocument;
    const root = doc.createDocumentFragment();
    const stack = [root];
    let last = 0;
    for (const match of text.matchAll(RICH)) {
      if (match.index > last) stack.at(-1).append(doc.createTextNode(text.slice(last, match.index)));
      last = match.index + match[0].length;
      const [, closing, tag] = match;
      if (tag === 'br') stack.at(-1).append(doc.createElement('br'));
      else if (closing) { if (stack.length > 1) stack.pop(); }
      else { const child = doc.createElement(tag); stack.at(-1).append(child); stack.push(child); }
    }
    if (last < text.length) stack.at(-1).append(doc.createTextNode(text.slice(last)));
    el.replaceChildren(root);
  }
  // data-i18n="key" sets the text, data-i18n-rich="key" allows <b>, <kbd> and
  // the like, data-i18n-attr="aria-label:key;placeholder:key" sets attributes.
  function applyI18n(root) {
    root = root || document;
    const all = selector => [...(root.matches && root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    for (const el of all('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of all('[data-i18n-rich]')) rich(el, t(el.dataset.i18nRich));
    for (const el of all('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const at = pair.indexOf(':');
        const name = pair.slice(0, at).trim(), key = pair.slice(at + 1).trim();
        if (at > 0 && name && key) el.setAttribute(name, t(key));
      }
    }
    return root;
  }

  async function defaultCall(op, body) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) throw Error('no local service');
    let token = '';
    try { token = sessionStorage.getItem('tore-local-session') || ''; } catch { token = ''; }
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('no local session');
    const response = await fetch('/api/private/tore/' + op, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'ui-language');
    return result;
  }
  const call = (op, body) => (caller || defaultCall)(op, body);

  function bindSwitches(root) {
    for (const button of (root || document).querySelectorAll('[data-ui-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.uiLang === lang));
      if (!button.dataset.uiLangBound) {
        button.dataset.uiLangBound = '1';
        button.addEventListener('click', () => { choose(button.dataset.uiLang); });
      }
    }
  }
  function show(next) {
    lang = next;
    if (typeof document === 'undefined') return;
    document.documentElement.lang = next;
    applyI18n(document);
    bindSwitches(document);
  }

  // Reads the saved choice once. Pages await this before their first render.
  function init(callFn) {
    if (callFn) caller = callFn;
    if (!ready) {
      ready = (async () => {
        let saved = null;
        try { saved = valid((await call('ui-language-get', {}))?.language); } catch { saved = null; }
        show(saved || fromNavigator());
        settle(lang);
        return lang;
      })();
    }
    return ready;
  }

  // The EN | TR switch. Pages that can redraw in place register onChange;
  // otherwise the page reloads once the choice is saved.
  async function choose(next) {
    next = valid(next);
    if (!next || next === lang) { bindSwitches(document); return lang; }
    for (const guard of guards) { if (guard(next) === false) { bindSwitches(document); return lang; } }
    let saved = true;
    try { await call('ui-language-set', { language: next }); } catch { saved = false; }
    if (!listeners.length && saved && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) { location.reload(); return next; }
    show(next);
    for (const fn of listeners.slice()) { try { fn(next); } catch (error) { if (typeof console !== 'undefined') console.error(error); } }
    return next;
  }
  const onChange = fn => { listeners.push(fn); };
  // A guard returning false keeps the current language (for example, unsaved edits).
  const beforeChange = fn => { guards.push(fn); };

  globalThis.toreI18n = {
    add, addServer, t, n, has, server, applyI18n, init, choose, onChange, beforeChange, bindSwitches,
    whenReady: () => settled, lang: () => lang, locale: () => LOCALES[lang], languages: LANGS.slice(), fromNavigator,
    // For tests: the raw entries, never used by pages.
    entries: () => dict, serverEntries: () => serverText
  };
  if (typeof document !== 'undefined') {
    const start = () => { bindSwitches(document); init(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else bindSwitches(document);
  }

  add({
    'common.skip': ['İçeriğe geç', 'Skip to content'],
    'common.home': ['töre ana sayfa', 'töre home'],
    'common.mainNav': ['Ana gezinme', 'Main navigation'],
    'common.private': ['Bu bilgisayarda', 'On this computer'],
    'lang.group': ['Arayüz dili', 'Interface language'],
    'nav.topics': ['Konular', 'Topics'],
    'nav.waiting': ['Seni bekleyenler', 'Waiting for you'],
    'nav.map': ['Haritam', 'My map'],
    'nav.conversations': ['Konuşmalar', 'Conversations'],
    'nav.thinkers': ['Düşünürler', 'Thinkers'],
    'nav.archive': ['Arşiv', 'Archive'],
    'nav.update': ['Güncelle', 'Update'],
    'nav.surpassed': ['Aşılmış düşünceler', 'Surpassed thoughts'],
    'nav.canvas': ['Tuval', 'Canvas'],
    'nav.list': ['Liste', 'List'],
    'nav.underMap': ['Haritam altında', 'Under My map'],
    'nav.underConversations': ['Konuşmalar altında', 'Under Conversations'],
    'title.topics': ['töre — Konular', 'töre — Topics'],
    'title.conversations': ['töre — Konuşmalarım', 'töre — My conversations'],
    'title.map': ['töre — Haritam', 'töre — My map'],
    'title.thinkers': ['töre — Düşünürler', 'töre — Thinkers'],
    'title.archive': ['töre — Arşiv', 'töre — Archive'],
    'title.update': ['töre — Güncelle', 'töre — Update'],
    'title.surpassed': ['töre — Aşılmış düşünceler', 'töre — Surpassed thoughts'],
    'title.opinions': ['töre — Eski görüş defteri', 'töre — Old opinion notebook'],
    // private-client.js: connection, files and the close button in every footer.
    'client.reopen': ['töre\'yi Başlat.command ile yeniden aç; dosyaların yerinde duruyor.', 'Open töre again with Başlat.command; your files are where they were.'],
    'client.disconnected': ['töre\'nin bağlantısı kopmuş. {reopen}', 'töre lost its connection. {reopen}'],
    'client.unreachable': ['töre\'ye ulaşılamıyor. {reopen}', 'töre cannot be reached. {reopen}'],
    'client.badResponse': ['töre beklenmeyen bir yanıt verdi. {reopen}', 'töre gave an unexpected answer. {reopen}'],
    'client.failed': ['İşlem tamamlanamadı. Sayfayı yenileyip yeniden dene.', 'That did not finish. Reload the page and try again.'],
    'client.fileBroken': ['{path} okunamıyor; dosya bozuk görünüyor. Hiçbir şey silinmedi.', '{path} cannot be read; the file looks damaged. Nothing was deleted.'],
    'client.fileChanged': ['Dosya başka bir pencerede değişti; üzerine yazılmadı. Sayfayı yenile.', 'The file changed in another window and was not overwritten. Reload the page.'],
    'client.unverified': ['Yazılan dosya doğrulanamadı. Sayfayı yenileyip yeniden dene.', 'The written file could not be checked. Reload the page and try again.'],
    'client.close': ['Uygulamayı kapat', 'Close the app'],
    'client.cancel': ['Vazgeç', 'Cancel'],
    'client.closeConfirm': ['Evet, kapat', 'Yes, close'],
    'client.closeAsk': ['Kapatılsın mı? Dosyaların yerinde kalır.', 'Close töre? Your files stay where they are.'],
    'client.closed': ['Uygulama kapandı', 'The app is closed'],
    'client.closing': ['töre kapanıyor. Dosyaların yerinde. Yeniden açmak için Başlat.command dosyasına çift tıkla.', 'töre is closing. Your files are where they were. To open it again, double-click Başlat.command.']
  });

  // The most common service messages. The friendly Turkish rewording lives in
  // private-client.js; English readers get the same advice in English.
  addServer({
    'Konu deposu dışarıdan değişmiş; üzerine yazılmadı': 'The notebook changed in another window. Reload the page; nothing you wrote is lost.',
    'Konu deposu başka bir Töre sürecinde açık': 'The notebook is open in another töre window. Close the other one, then reload the page.',
    'Konu deposu yazma hatasından sonra kilitlendi; yeniden açın': 'The notebook locked itself after a write error. Open töre again with Başlat.command; your files are where they were.',
    'Konu deposu bozuk; sıfırlanmadı': 'The notebook file could not be read. Nothing was deleted; you can go back to one of your backups under Topics.',
    'Konu deposu bozuk; okunmadı': 'The notebook file could not be read. Nothing was deleted; you can go back to one of your backups under Topics.',
    'Konu deposu değişti; geri alma önizlemesini yenileyin': 'The notebook changed in the meantime. Refresh the preview, then try again.',
    'Kayıt değişmiş; yeniden yükleyin': 'This record changed in another window. Reload the page, then try again.',
    'Kaydın konusu değişmiş; incelemeden önce yeniden yükleyin': 'This record moved to another topic. Reload the page, then try again.',
    'Kayıt bulunamadı': 'This record is no longer in the notebook. Reload the page.',
    'Konu bulunamadı': 'This topic is no longer in the notebook. Reload the page.',
    'Kayıt içeriği veya durumları geçersiz': 'The record could not be saved like this. Check the text and the states you chose, then try again.',
    'İstek kimliği başka içerik için kullanılmış': 'This action was just sent with different content. Reload the page, then try again.',
    'Harita girdisi bulunamadı': 'This record is no longer on the map. Reload the page.',
    'Haritadaki kayıt bulunamadı': 'This record is no longer on the map. Reload the page.',
    'Harita girdisi sınırı aşıldı': 'The map has no room for more records. Take a few off the map first.',
    'Önce bu girdiye bağlı itiraz, cevap ve ölçütleri çıkarın': 'First take the objections, answers and criteria linked to this record off the map.',
    'Bağlantı bulunamadı': 'This link no longer exists. Reload the page.',
    'Düşünür bağlantısı sınırı aşıldı': 'No more links can be made. Remove a few first.',
    'Devam paketi bulunamadı': 'This continuation text no longer exists. Reload the page.',
    'Yerel erişim anahtarı, Host veya Origin geçersiz': 'This page is not allowed to reach töre. Open töre again with Başlat.command.',
    'Bilinmeyen Töre işlemi': 'töre does not know this action. Reload the page.',
    'Konuşma bulunamadı': 'This conversation is no longer here. Reload the page.',
    'Görünür konuşma mesajı bulunamadı': 'No readable conversation messages were found in this file.',
    'Başka bir dosya inceleniyor; bitmesini bekleyin': 'Another file is being read. Wait for it to finish.',
    'Dosya boyutu sınırı aşıldı': 'The file is too large.',
    'Dosya/metin sınırı aşıldı': 'The file or text is too large.',
    'Dosya kodlaması geçersiz': 'The file encoding is not valid.',
    'Önizleme bulunamadı; yeniden içe aktarın': 'The preview is gone. Import the file again.',
    'Önizleme belleği dolu; mevcut önizlemeyi kaydedin veya uygulamayı yeniden açın': 'Preview memory is full. Save the current preview or open töre again.',
    'En az bir konuşma seçin': 'Choose at least one conversation.',
    'Konuşma seçin': 'Choose a conversation.',
    'Oturum seçin': 'Choose a session.',
    'Bir seferde 1 ile 50 arasında oturum seçin': 'Choose between 1 and 50 sessions at a time.',
    'Ev klasörü bulunamadı': 'The home folder could not be found.',
    'Aynı kaynak kimliğinin farklı sürümü bulundu; mevcut konuşmanın üzerine yazılmadı': 'A different version of the same conversation was found; the existing one was not overwritten.',
    'Yerel durum kilidi kullanılamıyor; yeniden başlatın': 'töre\'s local state is locked. Open töre again.',
    'Desteklenmeyen arayüz dili': 'This interface language is not supported.',
    'Bu tam önizleme için açık onay gerekli': 'This preview needs your explicit confirmation.'
  });
})();
