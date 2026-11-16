/* Töre — 0.1.1 uyumlu — yalnızca kullanıcının seçtiği klasörde çalışan depolama çekirdeği. */
(function (root) {
  'use strict';
  const MAIN = 'arsiv.json';
  const PREVIOUS = 'arsiv.onceki.json';
  const REPORTS = 'raporlar';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const DIGEST = /^[0-9a-f]{64}$/;
  const encoder = new TextEncoder();
  const clone = value => JSON.parse(JSON.stringify(value));

  class ArchiveError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'ArchiveError';
      this.code = code;
      this.recoverable = Boolean(options.recoverable);
      if (options.cause) this.cause = options.cause;
    }
  }
  function fail(code, message, cause) { return new ArchiveError(code, message, { cause }); }
  function decodeUTF8(bytes) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\u0000')) throw new Error('NUL karakteri');
      return text;
    } catch (cause) {
      throw fail('ENCODING', 'Dosya geçerli UTF-8 Markdown metni değil. UTF-8 olarak dışa aktarıp yeniden deneyin.', cause);
    }
  }
  async function sha256(bytes) {
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  }
  function fold(text) { return text.normalize('NFC').toLocaleLowerCase('tr-TR'); }
  function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function exactKeys(value, keys) {
    return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  }
  function validateManifest(input) {
    if (!plainObject(input) || !exactKeys(input, ['schemaVersion', 'appVersion', 'revision', 'reports']) || input.schemaVersion !== 1 || input.appVersion !== '0.1.1' || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.reports)) {
      throw fail('MANIFEST', 'Arşiv kaydının yapısı veya şema sürümü desteklenmiyor; dosya değiştirilmedi.');
    }
    const ids = new Set();
    const hashes = new Set();
    const reports = input.reports.map(record => {
      if (!plainObject(record) || !exactKeys(record, ['id', 'originalName', 'title', 'addedAt', 'path', 'sha256', 'trashed']) || typeof record.id !== 'string' || !UUID.test(record.id) || ids.has(record.id) || typeof record.sha256 !== 'string' || !DIGEST.test(record.sha256) || hashes.has(record.sha256) || record.path !== `${REPORTS}/${record.id}.md` || typeof record.originalName !== 'string' || !/\.md$/i.test(record.originalName) || /[\u0000-\u001f/\\]/.test(record.originalName) || typeof record.title !== 'string' || /\u0000/.test(record.title) || typeof record.addedAt !== 'string' || !Number.isFinite(Date.parse(record.addedAt)) || new Date(record.addedAt).toISOString() !== record.addedAt || typeof record.trashed !== 'boolean') {
        throw fail('MANIFEST', 'Arşivde geçersiz/tekrarlanan kimlik, dosya yolu, içerik özeti veya rapor bilgisi var; dosya değiştirilmedi.');
      }
      ids.add(record.id); hashes.add(record.sha256);
      return { id: record.id, originalName: record.originalName, title: record.title, addedAt: record.addedAt, path: record.path, sha256: record.sha256, trashed: record.trashed };
    });
    return { schemaVersion: 1, appVersion: '0.1.1', revision: input.revision, reports };
  }
  function parseManifest(text) {
    let input;
    try { input = JSON.parse(text); } catch (cause) { throw fail('MANIFEST', 'arsiv.json okunamadı: geçerli JSON değil. Arşiv sıfırlanmadı.', cause); }
    return validateManifest(input);
  }
  async function optionalFile(dir, name) {
    try { return await dir.getFileHandle(name); } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function fileBytes(handle) { return new Uint8Array(await (await handle.getFile()).arrayBuffer()); }
  function bytesEqual(a, b) { return a.length === b.length && a.every((value, i) => value === b[i]); }
  async function writeVerified(dir, name, bytes, mustBeNew = false) {
    const existing = await optionalFile(dir, name);
    if (existing && mustBeNew) throw fail('COLLISION', `Mevcut dosyanın üzerine yazılmadı: ${name}`);
    const handle = existing || await dir.getFileHandle(name, { create: true });
    let writer;
    try {
      writer = await handle.createWritable();
      await writer.write(bytes);
      await writer.close();
      writer = null;
      const reread = await fileBytes(handle);
      if (!bytesEqual(bytes, reread)) throw fail('WRITE', `Disk doğrulaması eşleşmedi: ${name}`);
    } catch (error) {
      if (writer && writer.abort) { try { await writer.abort(); } catch (_) { /* Asıl yazma hatasını koru. */ } }
      throw error;
    }
  }
  async function reportDirectory(dir, create = false) { return await dir.getDirectoryHandle(REPORTS, { create }); }
  async function readRecord(dir, record) {
    let bytes;
    try { bytes = await fileBytes(await (await reportDirectory(dir)).getFileHandle(`${record.id}.md`)); }
    catch (cause) { throw fail('MISSING_FILE', `Rapor dosyası okunamadı veya eksik: ${record.path}. Arşiv kaydı korundu.`, cause); }
    if (await sha256(bytes) !== record.sha256) throw fail('HASH', `Raporun içerik özeti eşleşmiyor: ${record.path}. Dosya dışarıdan değişmiş olabilir.`);
    decodeUTF8(bytes);
    return bytes;
  }
  async function verifyRecords(dir, manifest) {
    try { await reportDirectory(dir); } catch (cause) { throw fail('MISSING_FILE', 'raporlar klasörü okunamadı veya eksik. Arşiv sıfırlanmadı.', cause); }
    for (const record of manifest.reports) await readRecord(dir, record);
  }
  async function candidate(dir, name) {
    const handle = await optionalFile(dir, name);
    if (!handle) throw fail('MANIFEST_MISSING', `${name} bulunamadı. Arşiv otomatik sıfırlanmadı.`);
    const raw = decodeUTF8(await fileBytes(handle));
    return { raw, manifest: parseManifest(raw) };
  }
  async function emptyNewDirectory(dir) {
    for await (const [name, handle] of dir.entries()) {
      if (name === REPORTS && handle.kind === 'directory') {
        for await (const _ of handle.entries()) return false;
      } else return false;
    }
    return true;
  }
  async function recoveryAvailable(dir) {
    try { const prior = await candidate(dir, PREVIOUS); await verifyRecords(dir, prior.manifest); return true; } catch (_) { return false; }
  }
  async function withLock(action) {
    if (root.navigator && root.navigator.locks && root.navigator.locks.request) {
      return await root.navigator.locks.request('toru-0.1.1-archive-write', { mode: 'exclusive' }, action);
    }
    return await action();
  }
  function fromBase64(text) {
    if (typeof text !== 'string' || text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw fail('BACKUP', 'Yedekte geçersiz Base64 dosya verisi var.');
    let binary;
    try { binary = root.atob(text); } catch (cause) { throw fail('BACKUP', 'Yedek dosya baytları çözülemedi.', cause); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (toBase64(bytes) !== text) throw fail('BACKUP', 'Yedekte standart olmayan Base64 verisi var.');
    return bytes;
  }
  function toBase64(bytes) {
    const chunks = [];
    for (let start = 0; start < bytes.length; start += 32768) chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
    return root.btoa(chunks.join(''));
  }
  async function validateBackup(input) {
    if (!plainObject(input) || ![1,2,3,4,5].includes(input.version) || !exactKeys(input, input.version>=4?['format','version','manifest','files','profiles','comparisons','extras']:input.version===3?['format','version','manifest','files','profiles','comparisons']:input.version===2?['format', 'version', 'manifest', 'files', 'profiles']:['format', 'version', 'manifest', 'files']) || input.format !== 'toru-backup' || !Array.isArray(input.files)) throw fail('BACKUP', 'Bu dosya desteklenen Töre yedeği değil.');
    const manifest = validateManifest(input.manifest);
    if (input.files.length !== manifest.reports.length) throw fail('BACKUP', 'Yedekteki dosya sayısı arşiv kaydıyla eşleşmiyor.');
    const records = new Map(manifest.reports.map(record => [record.id, record]));
    const files = new Map();
    for (const item of input.files) {
      if (!plainObject(item) || !exactKeys(item, ['id', 'data']) || !records.has(item.id) || files.has(item.id)) throw fail('BACKUP', 'Yedekte eksik, tekrarlanan veya kayıtsız dosya kimliği var.');
      const bytes = fromBase64(item.data);
      decodeUTF8(bytes);
      if (await sha256(bytes) !== records.get(item.id).sha256) throw fail('BACKUP_HASH', 'Yedekteki dosyanın içerik özeti eşleşmiyor. Hiçbir dosya yazılmadı.');
      files.set(item.id, bytes);
    }
    let profiles=null;
    if(input.version>=2){
      if(!root.ToreProfiles)throw fail('BACKUP_PROFILES','Bu yedeği okumak için Töre profil desteği gerekir.');
      profiles=root.ToreProfiles.validateDocument(input.profiles,manifest.reports);
    }
    let comparisons=null;
    if(input.version>=3){if(!root.ToreComparisons)throw fail('BACKUP_COMPARISONS','Bu yedek için özel karşılaştırma desteği gerekir.');comparisons=root.ToreComparisons.validateDocument(input.comparisons,profiles,manifest.reports);}
    const extras=new Map();
    if(input.version>=4){
      if(!plainObject(input.extras)||!root.ToreExtras)throw fail('BACKUP_EXTRAS','Ek katalog desteği veya ek dosya listesi eksik.');
      if(input.version===5&&(Object.keys(input.extras).length!==4||EXTRA_NAMES.some(name=>!Object.hasOwn(input.extras,name))))throw fail('BACKUP_EXTRAS','V5 yedeğinde gerekli ek dosya listesi eksik. Hiçbir dosya yazılmadı.');
      for(const [name,item]of Object.entries(input.extras)){
        if((input.version===4&&!['kaynaklar.json','temsilciler.json'].includes(name))||!root.ToreExtras.names.includes(name)||!plainObject(item)||!exactKeys(item,['data','sha256'])||typeof item.sha256!=='string'||!DIGEST.test(item.sha256))throw fail('BACKUP_EXTRAS','Yedekte izin verilmeyen ek dosya yolu veya geçersiz özet var. Hiçbir dosya yazılmadı.');
        const bytes=fromBase64(item.data);if(await sha256(bytes)!==item.sha256)throw fail('BACKUP_EXTRAS_HASH','Ek katalog içerik özeti eşleşmiyor. Hiçbir dosya yazılmadı.');
        let document;try{document=JSON.parse(decodeUTF8(bytes));}catch(cause){throw fail('BACKUP_EXTRAS','Ek katalog geçerli UTF-8 JSON değil. Hiçbir dosya yazılmadı.',cause);}
        extras.set(name,{bytes,sha256:item.sha256,document});
      }
    }
    for(const [name,item]of extras)root.ToreExtras.validate(name,item.document,manifest.reports,profiles,extras.get('kaynaklar.json')?.document||{format:'tore-sources',version:1,revision:0,items:[]});
    return { manifest, files, profiles, comparisons, extras };
  }
  async function profileState(dir,reports){
    if(!await optionalFile(dir,'profiller.json')&&!await optionalFile(dir,'profiller.onceki.json'))return null;
    if(!root.ToreProfiles)throw fail('BACKUP_PROFILES','Profil kayıtlarını doğrulamak için Töre profil desteği gerekir.');
    return await root.ToreProfiles.readDocument(dir,reports);
  }

  async function comparisonState(dir,profiles,reports){
    if(!await optionalFile(dir,'karsilastirmalar.json')&&!await optionalFile(dir,'karsilastirmalar.onceki.json'))return null;
    if(!root.ToreComparisons)throw fail('BACKUP_COMPARISONS','Karşılaştırmalar doğrulanamadı; yedekten sessizce çıkarılmadı.');
    return root.ToreComparisons.readDocument(dir,profiles,reports);
  }

  const EXTRA_NAMES=['kaynaklar.json','temsilciler.json','okuma.json','degisimler.json'];
  async function extrasState(dir,reports,profiles){
    const states=new Map();
    for(const name of EXTRA_NAMES){
      const handle=await optionalFile(dir,name),prior=await optionalFile(dir,name.replace(/\.json$/,'.onceki.json'));
      if(!handle){if(prior)throw fail('BACKUP_EXTRAS',name+' eksik fakat önceki kaydı mevcut. Ek katalog yedekten sessizce çıkarılmadı; dosyaları denetleyin.');continue;}
      if(!root.ToreExtras)throw fail('BACKUP_EXTRAS','Bu ek katalog için Töre 0.4 yedek desteği gerekir.');
      const bytes=await fileBytes(handle);let document;try{document=JSON.parse(decodeUTF8(bytes));}catch(cause){throw fail('BACKUP_EXTRAS',name+' geçerli UTF-8 JSON değil; sıfırlanmadı veya yedekten çıkarılmadı.',cause);}
      states.set(name,{bytes,sha256:await sha256(bytes),document});
    }for(const [name,state]of states)root.ToreExtras.validate(name,state.document,reports,profiles,states.get('kaynaklar.json')?.document||{format:'tore-sources',version:1,revision:0,items:[]});return states;
  }
  async function assertExtrasUnchanged(dir,before,reports,profiles){const current=await extrasState(dir,reports,profiles);if(current.size!==before.size||[...before].some(([name,state])=>current.get(name)?.sha256!==state.sha256))throw fail('EXTRAS_STALE','Ek katalog başka bir işlemde değişti; üzerine yazılmadı. Arşivi yeniden açın.');}

  class Archive {
    constructor(dir, manifest, raw) {
      this.dir = dir;
      this._manifest = manifest;
      this._raw = raw;
      this._queue = Promise.resolve();
      this._valid = true;
    }
    get manifest() { return clone(this._manifest); }
    static async open(dir) {
      return await withLock(async () => {
        if (!dir || dir.kind !== 'directory') throw fail('FOLDER', 'Bir veri klasörü seçin.');
        const current = await optionalFile(dir, MAIN);
        if (!current && await emptyNewDirectory(dir)) {
          const manifest = { schemaVersion: 1, appVersion: '0.1.1', revision: 0, reports: [] };
          const raw = JSON.stringify(manifest, null, 2) + '\n';
          try { await reportDirectory(dir, true); await writeVerified(dir, MAIN, encoder.encode(raw), true); }
          catch (cause) { throw fail('WRITE', 'Yeni arşiv diske kaydedilemedi. Kalıcı kayıt başarılı olmadı; izinleri kontrol edip klasörü yeniden seçin.', cause); }
          return new Archive(dir, manifest, raw);
        }
        try {
          const loaded = await candidate(dir, MAIN);
          await verifyRecords(dir, loaded.manifest);
          return new Archive(dir, loaded.manifest, loaded.raw);
        } catch (cause) {
          const recoverable = await recoveryAvailable(dir);
          throw new ArchiveError(cause.code || 'OPEN', `${cause.message} ${recoverable ? 'Doğrulanmış önceki arşiv kaydı kurtarılabilir.' : 'Dosyalar değiştirilmedi; bir yedeği yeni boş klasöre geri yükleyebilir veya klasörü elle inceleyebilirsiniz.'}`, { recoverable, cause });
        }
      });
    }
    static async recover(dir) {
      return await withLock(async () => {
        try { const current = await candidate(dir, MAIN); await verifyRecords(dir, current.manifest); throw fail('HEALTHY', 'Ana arşiv sağlam; önceki kayda dönülmedi.'); }
        catch (error) { if (error.code === 'HEALTHY') throw error; }
        const prior = await candidate(dir, PREVIOUS);
        await verifyRecords(dir, prior.manifest);
        try {
          const broken = await optionalFile(dir, MAIN);
          if (broken) {
            const preservedName = `arsiv.bozuk-${new Date().toISOString().replace(/[:.]/g, '-')}-${root.crypto.randomUUID()}.json`;
            await writeVerified(dir, preservedName, await fileBytes(broken), true);
          }
          await writeVerified(dir, MAIN, encoder.encode(prior.raw));
        }
        catch (cause) { throw fail('WRITE', 'Önceki kayıt geri yazılamadı. Önceki sağlam kayıt korundu; başarı bildirilmedi.', cause); }
        return new Archive(dir, prior.manifest, prior.raw);
      });
    }
    _enqueue(action) {
      const result = this._queue.then(() => withLock(async () => {
        if (!this._valid) throw fail('REOPEN', 'Önceki disk işlemi tamamlanamadı. Veri güvenliği için klasörü yeniden seçin.');
        return await action();
      }));
      this._queue = result.catch(() => {});
      return result;
    }
    async _assertCurrent() {
      const current = await candidate(this.dir, MAIN);
      if (current.raw !== this._raw) throw fail('STALE', 'Arşiv başka bir sekmede veya dışarıdan değişti. Üzerine yazılmadı; klasörü yeniden seçin.');
    }
    async _commit(next) {
      await this._assertCurrent();
      validateManifest(next);
      await verifyRecords(this.dir, this._manifest);
      const previousHandle = await optionalFile(this.dir, PREVIOUS);
      if (previousHandle) {
        try { parseManifest(decodeUTF8(await fileBytes(previousHandle))); }
        catch (cause) { throw fail('PREVIOUS', 'arsiv.onceki.json beklenen sağlam arşiv kaydı değil. Üzerine yazılmadı; dosyayı elle koruyup klasörü yeniden seçin.', cause); }
      }
      const raw = JSON.stringify(next, null, 2) + '\n';
      await writeVerified(this.dir, PREVIOUS, encoder.encode(this._raw));
      await this._assertCurrent();
      await writeVerified(this.dir, MAIN, encoder.encode(raw));
      this._manifest = next;
      this._raw = raw;
    }
    _record(id) {
      const record = this._manifest.reports.find(item => item.id === id);
      if (!record) throw fail('REPORT', 'Rapor kaydı bulunamadı.');
      return record;
    }
    async importFile(file) {
      return await this._enqueue(async () => {
        if (!file || typeof file.name !== 'string' || !/\.md$/i.test(file.name) || /[\u0000-\u001f/\\]/.test(file.name)) throw fail('EXTENSION', 'Yalnızca .md uzantılı Markdown dosyaları yüklenebilir.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        decodeUTF8(bytes);
        const hash = await sha256(bytes);
        await this._assertCurrent();
        const existing = this._manifest.reports.find(record => record.sha256 === hash);
        if (existing) { await readRecord(this.dir, existing); return { record: clone(existing), duplicate: true }; }
        const id = root.crypto.randomUUID();
        const record = { id, originalName: file.name, title: file.name.slice(0, -3), addedAt: new Date().toISOString(), path: `${REPORTS}/${id}.md`, sha256: hash, trashed: false };
        const next = clone(this._manifest); next.revision++; next.reports.push(record);
        let touchedDisk = false;
        try {
          const reports = await reportDirectory(this.dir);
          if (await optionalFile(reports, `${id}.md`)) throw fail('COLLISION', 'Üretilen kimlik mevcut bir dosyayla çakıştı; üzerine yazılmadı. Yeniden deneyin.');
          touchedDisk = true;
          await writeVerified(reports, `${id}.md`, bytes, true);
          await this._commit(next);
        } catch (cause) {
          if (touchedDisk) this._valid = false;
          throw new ArchiveError(cause.code || 'WRITE', `Rapor kaydedilemedi: ${cause.message} Başarı bildirilmedi.${touchedDisk ? ' Klasörü yeniden seçin; kayıtsız bir dosya kalmış olabilir.' : ''}`, { cause });
        }
        return { record: clone(record), duplicate: false };
      });
    }
    async readBytes(id) { return await readRecord(this.dir, this._record(id)); }
    async readText(id) { return decodeUTF8(await this.readBytes(id)); }
    async rename(id, title) {
      return await this._enqueue(async () => {
        if (typeof title !== 'string' || !title.trim() || title.includes('\u0000')) throw fail('TITLE', 'Görünen başlık boş olamaz.');
        const next = clone(this._manifest); const record = next.reports.find(item => item.id === this._record(id).id);
        record.title = title.trim(); next.revision++;
        try { await this._commit(next); } catch (cause) { this._valid = false; throw fail(cause.code || 'WRITE', `Başlık kaydedilemedi: ${cause.message} Klasörü yeniden seçin.`, cause); }
        return clone(record);
      });
    }
    async setTrashed(id, trashed) {
      return await this._enqueue(async () => {
        if (typeof trashed !== 'boolean') throw fail('TRASH', 'Çöp kutusu durumu geçersiz.');
        const next = clone(this._manifest); const record = next.reports.find(item => item.id === this._record(id).id);
        record.trashed = trashed; next.revision++;
        try { await this._commit(next); } catch (cause) { this._valid = false; throw fail(cause.code || 'WRITE', `Çöp kutusu durumu kaydedilemedi: ${cause.message} Klasörü yeniden seçin.`, cause); }
        return clone(record);
      });
    }
    async backup() {
      return await this._enqueue(async () => {
        await this._assertCurrent();
        const files = [];
        for (const record of this._manifest.reports) files.push({ id: record.id, data: toBase64(await readRecord(this.dir, record)) });
        await this._assertCurrent();
        const profiles=await profileState(this.dir,this._manifest.reports);
        await this._assertCurrent();
        const profileDocument=profiles?profiles.document:{schemaVersion:1,revision:0,profiles:[]};
        const comparisons=await comparisonState(this.dir,profileDocument,this._manifest.reports);
        const extraStates=await extrasState(this.dir,this._manifest.reports,profileDocument);
        await this._assertCurrent();
        if((await profileState(this.dir,this._manifest.reports))?.raw!==profiles?.raw||(await comparisonState(this.dir,profileDocument,this._manifest.reports))?.raw!==comparisons?.raw)throw fail('BACKUP_STALE','Profil veya karşılaştırma yedekleme sırasında değişti; yedek oluşturulmadı.');
        await assertExtrasUnchanged(this.dir,extraStates,this._manifest.reports,profileDocument);
        if(extraStates.size){const extras={};for(const [name,state]of extraStates)extras[name]={data:toBase64(state.bytes),sha256:state.sha256};if(extraStates.has('okuma.json')||extraStates.has('degisimler.json'))for(const name of EXTRA_NAMES)if(!extras[name]){const bytes=encoder.encode(JSON.stringify(root.ToreExtras.empty(name),null,2)+'\n');extras[name]={data:toBase64(bytes),sha256:await sha256(bytes)};}return {format:'toru-backup',version:(extraStates.has('okuma.json')||extraStates.has('degisimler.json'))?5:4,manifest:clone(this._manifest),files,profiles:clone(profileDocument),comparisons:clone(comparisons?.document||{schemaVersion:1,revision:0,comparisons:[]}),extras};}
        if(comparisons)return {format:'toru-backup',version:3,manifest:clone(this._manifest),files,profiles:clone(profileDocument),comparisons:clone(comparisons.document)};
        return profiles?{format:'toru-backup',version:2,manifest:clone(this._manifest),files,profiles:clone(profiles.document)}:{format:'toru-backup',version:1,manifest:clone(this._manifest),files};
      });
    }
    async restore(input) {
      return await this._enqueue(async () => {
        const validated = await validateBackup(input);
        await this._assertCurrent();
        if (this._manifest.reports.length !== 0) throw fail('NOT_EMPTY', 'Geri yükleme yalnızca yeni/boş arşive yapılabilir. Mevcut dolu arşiv değiştirilmedi.');
        const profileBefore=await profileState(this.dir,this._manifest.reports);
        if(profileBefore&&profileBefore.document.profiles.length)throw fail('NOT_EMPTY','Veri klasöründe profil kayıtları var. Geri yüklemek için yeni boş klasör seçin; mevcut profiller değiştirilmedi.');
        const comparisonBefore=await comparisonState(this.dir,profileBefore?profileBefore.document:{schemaVersion:1,revision:0,profiles:[]},this._manifest.reports);
        if(comparisonBefore?.document.comparisons.length)throw fail('NOT_EMPTY','Veri klasöründe karşılaştırmalar var; yeni boş klasör seçin.');
        const extraBefore=await extrasState(this.dir,this._manifest.reports,profileBefore?.document||{schemaVersion:1,revision:0,profiles:[]});
        if([...extraBefore.values()].some(state=>state.document.items.length))throw fail('NOT_EMPTY','Veri klasöründe ek kayıtlar var; yeni boş klasör seçin.');
        for await (const [name, handle] of this.dir.entries()) {
          if ((name === MAIN || name === PREVIOUS || name==='profiller.json' || name==='profiller.onceki.json' || name==='karsilastirmalar.json' || name==='karsilastirmalar.onceki.json' || EXTRA_NAMES.includes(name) || EXTRA_NAMES.some(extra=>extra.replace(/\.json$/,'.onceki.json')===name)) && handle.kind === 'file') continue;
          if (name === REPORTS && handle.kind === 'directory') { for await (const _ of handle.entries()) throw fail('NOT_EMPTY', 'raporlar klasörü boş değil; mevcut dosyaların üzerine yazılmadı.'); }
          else throw fail('NOT_EMPTY', 'Veri klasöründe başka dosyalar var. Geri yüklemek için yeni boş bir klasör seçin.');
        }
        try {
          const reports = await reportDirectory(this.dir);
          for (const record of validated.manifest.reports) await writeVerified(reports, `${record.id}.md`, validated.files.get(record.id), true);
          if(validated.profiles){
            const current=await profileState(this.dir,this._manifest.reports);
            if((current?current.raw:null)!==(profileBefore?profileBefore.raw:null))throw fail('PROFILES_STALE','Geri yüklerken profil kaydı değişti; üzerine yazılmadı.');
            const priorHandle=await optionalFile(this.dir,'profiller.onceki.json');
            if(priorHandle)root.ToreProfiles.validateDocument(JSON.parse(decodeUTF8(await fileBytes(priorHandle))),this._manifest.reports);
            const emptyProfile={schemaVersion:1,revision:0,profiles:[]};
            await writeVerified(this.dir,'profiller.onceki.json',encoder.encode(profileBefore?profileBefore.raw:JSON.stringify(emptyProfile,null,2)+'\n'));
            const profileRaw=JSON.stringify(validated.profiles,null,2)+'\n';
            await writeVerified(this.dir,'profiller.json',encoder.encode(profileRaw),!profileBefore);
            const restoredProfiles=await profileState(this.dir,validated.manifest.reports);
            if(JSON.stringify(restoredProfiles.document)!==JSON.stringify(validated.profiles))throw fail('BACKUP_PROFILES','Geri yüklenen profil bilgileri eşleşmedi.');
          }
          if(validated.comparisons){
            const contextProfiles=(await profileState(this.dir,validated.manifest.reports))?.document||{schemaVersion:1,revision:0,profiles:[]};
            const current=await comparisonState(this.dir,contextProfiles,validated.manifest.reports);
            if((current?current.raw:null)!==(comparisonBefore?comparisonBefore.raw:null))throw fail('COMPARISONS_STALE','Geri yüklerken karşılaştırmalar değişti; üzerine yazılmadı.');
            const prior=await optionalFile(this.dir,'karsilastirmalar.onceki.json');
            if(prior)root.ToreComparisons.validateDocument(JSON.parse(decodeUTF8(await fileBytes(prior))),contextProfiles,validated.manifest.reports);
            const empty={schemaVersion:1,revision:0,comparisons:[]};
            await writeVerified(this.dir,'karsilastirmalar.onceki.json',encoder.encode(comparisonBefore?comparisonBefore.raw:JSON.stringify(empty,null,2)+'\n'));
            await writeVerified(this.dir,'karsilastirmalar.json',encoder.encode(JSON.stringify(validated.comparisons,null,2)+'\n'),!comparisonBefore);
            const checked=await comparisonState(this.dir,contextProfiles,validated.manifest.reports);
            if(JSON.stringify(checked.document)!==JSON.stringify(validated.comparisons))throw fail('BACKUP_COMPARISONS','Geri yüklenen karşılaştırmalar eşleşmedi.');
          }
          await assertExtrasUnchanged(this.dir,extraBefore,this._manifest.reports,profileBefore?.document||{schemaVersion:1,revision:0,profiles:[]});
          for(const [name,state]of validated.extras){
            const previous=extraBefore.get(name),priorName=name.replace(/\.json$/,'.onceki.json'),prior=await optionalFile(this.dir,priorName);
            if(prior){let doc;try{doc=JSON.parse(decodeUTF8(await fileBytes(prior)));}catch(cause){throw fail('BACKUP_EXTRAS','Önceki ek katalog bozuk; üzerine yazılmadı.',cause);}root.ToreExtras.validate(name,doc,this._manifest.reports,profileBefore?.document||{schemaVersion:1,revision:0,profiles:[]},extraBefore.get('kaynaklar.json')?.document||{format:'tore-sources',version:1,revision:0,items:[]});}
            if(previous)await writeVerified(this.dir,priorName,previous.bytes);else await writeVerified(this.dir,priorName,encoder.encode(JSON.stringify(root.ToreExtras.empty(name),null,2)+'\n'));
            await writeVerified(this.dir,name,state.bytes,!previous);
            const reread=await fileBytes(await this.dir.getFileHandle(name));if(await sha256(reread)!==state.sha256)throw fail('BACKUP_EXTRAS_HASH','Geri yüklenen ek katalog özgün baytlarla eşleşmedi.');
          }
          // Ana manifest en son yazılır; hata hâlinde başarı bildirilmez.
          await this._commit(validated.manifest);
          await verifyRecords(this.dir, this._manifest);
        } catch (cause) { this._valid = false; throw fail(cause.code || 'WRITE', `Yedek geri yüklenemedi: ${cause.message} Başarı bildirilmedi. Klasörü yeniden seçin; yarım kalmış dosyalar bulunabilir.`, cause); }
        return this.manifest;
      });
    }
  }
  root.ToruStore = Object.freeze({ Archive, ArchiveError, sha256, decodeUTF8, fold, validateManifest, validateBackup });
})(globalThis);
