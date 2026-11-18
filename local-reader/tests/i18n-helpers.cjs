'use strict';
// Shared by the page harnesses: load the interface language module into a jsdom
// window and answer the two language operations of the local service.
// Harnesses default to Turkish so the existing Turkish copy keeps being checked.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const web = path.resolve(__dirname, '../../web');
const UI_OPS = new Set(['ui-language-get', 'ui-language-set']);

// navigatorLanguage: what the browser says (default 'tr-TR').
function loadI18n(w, dictionaries = [], { navigatorLanguage = 'tr-TR' } = {}) {
  Object.defineProperty(w.navigator, 'language', { value: navigatorLanguage, configurable: true });
  w.eval(fs.readFileSync(path.join(web, 'i18n.js'), 'utf8'));
  for (const name of dictionaries) w.eval(fs.readFileSync(path.join(web, 'i18n-' + name + '.js'), 'utf8'));
  return w.toreI18n;
}

// A fake of the server side: { language: null | 'en' | 'tr', sets: [] }.
function languageStore(language = null) { return { language, sets: [] }; }
// Returns the response body for a language operation, or undefined for any other op.
function languageOp(store, op, body) {
  if (op === 'ui-language-get') { assert.deepEqual(body, {}); return { language: store.language }; }
  if (op === 'ui-language-set') {
    assert.deepEqual(Object.keys(body), ['language']);
    assert.ok(['en', 'tr'].includes(body.language), 'yalnız en ya da tr');
    store.language = body.language; store.sets.push(body.language);
    return { language: body.language };
  }
  return undefined;
}

module.exports = { loadI18n, languageStore, languageOp, UI_OPS, web };
