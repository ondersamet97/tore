/* Töre 0.3.0 — yalnızca görüntüleme; kaynak baytlara dokunmaz. */
(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parser = new marked.Marked({gfm:true, breaks:false, renderer:{
    html() { return '<span>[Gömülü HTML gösterilmedi]</span>'; },
    image(token) { return `<span>[Görsel yüklenmedi: ${escape(token.text || 'açıklama yok')}]</span>`; }
  }});
  function render(text, article, toc) {
    const clean = DOMPurify.sanitize(parser.parse(text), {
      ALLOWED_TAGS:['h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','ul','ol','li','blockquote','a','table','thead','tbody','tr','th','td','pre','code','span'],
      ALLOWED_ATTR:['href','title','start'], ALLOW_DATA_ATTR:false, ALLOW_ARIA_ATTR:false,
      RETURN_DOM_FRAGMENT:true
    });
    for (const a of clean.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      let valid = false;
      try { valid = /^https?:\/\//i.test(href) && ['https:','http:'].includes(new URL(href).protocol); } catch (_) { /* Güvenilmeyen bağlantı. */ }
      if (valid) { a.target='_blank'; a.rel='noopener noreferrer'; a.referrerPolicy='no-referrer'; }
      else { const span=document.createElement('span'); span.textContent=a.textContent+' [Bağlantı açılmadı]'; a.replaceWith(span); }
    }
    for (const table of clean.querySelectorAll('table')) {
      const box=document.createElement('div'); box.className='table-scroll'; box.tabIndex=0;
      box.setAttribute('role','region'); box.setAttribute('aria-label','Yatay kaydırılabilir tablo');
      table.replaceWith(box); box.append(table);
    }
    article.replaceChildren(clean);
    toc.replaceChildren();
    const heads=[...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    heads.forEach((h,i)=>{ h.id='bolum-'+i; });
    toc.hidden=heads.length<4;
    if (!toc.hidden) {
      const label=document.createElement('strong'); label.textContent='İçindekiler'; toc.append(label);
      for (const h of heads) {
        const b=document.createElement('button'); b.type='button'; b.textContent=h.textContent;
        b.className='toc-'+h.tagName.toLowerCase(); b.addEventListener('click',()=>h.scrollIntoView({block:'start'})); toc.append(b);
      }
    }
  }
  const fold = s => s.normalize('NFC').toLocaleLowerCase('tr-TR');
  globalThis.ToruReader={render,fold};
})();
