'use strict';
// Gerçek geçici dosyalarla FSA adaptörü; Chrome seçicisi/OS izni kanıtı değildir.
const fs = require('node:fs/promises');
const path = require('node:path');
const { File } = require('node:buffer');
function namedError(name, message) { const error = new Error(message); error.name = name; return error; }
function component(name) { if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\/\\\u0000]/.test(name)) throw namedError('SecurityError', 'Güvenli tek yol bileşeni gerekli.'); }
class DiskFile {
  constructor(p, state) { this.p = p; this.state = state; this.name = path.basename(p); this.kind = 'file'; }
  async getFile() {
    try { return new File([await fs.readFile(this.p)], this.name); }
    catch (error) { if (error.code === 'ENOENT') throw namedError('NotFoundError', 'Dosya bulunamadı'); throw error; }
  }
  async createWritable() {
    if (this.state.deny) throw namedError('NotAllowedError', 'Sentetik test: izin reddedildi');
    const self = this; let bytes;
    return {
      async write(value) {
        if (self.state.failName === self.name) throw namedError('QuotaExceededError', 'Sentetik test: disk yazma hatası');
        if (typeof value === 'string') bytes = Buffer.from(value);
        else if (value && typeof value.arrayBuffer === 'function') bytes = Buffer.from(await value.arrayBuffer());
        else bytes = Buffer.from(value);
      },
      async close() {
        const staged = self.p + '.test-writing';
        await fs.writeFile(staged, bytes); await fs.rename(staged, self.p);
      },
      async abort() {}
    };
  }
}
class DiskDir {
  constructor(p, state = {}) { this.p = p; this.state = state; this.name = path.basename(p); this.kind = 'directory'; }
  async queryPermission() { return this.state.deny ? 'denied' : 'granted'; }
  async requestPermission() { return this.queryPermission(); }
  async getFileHandle(name, options = {}) {
    component(name); const p = path.join(this.p, name);
    try { if (!(await fs.stat(p)).isFile()) throw namedError('TypeMismatchError', 'Dosya değil'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!options.create) throw namedError('NotFoundError', 'Dosya bulunamadı'); await fs.writeFile(p, '', { flag: 'wx' }); }
    return new DiskFile(p, this.state);
  }
  async getDirectoryHandle(name, options = {}) {
    component(name); const p = path.join(this.p, name);
    try { if (!(await fs.stat(p)).isDirectory()) throw namedError('TypeMismatchError', 'Klasör değil'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!options.create) throw namedError('NotFoundError', 'Klasör bulunamadı'); await fs.mkdir(p); }
    return new DiskDir(p, this.state);
  }
  async removeEntry(name, options = {}) { component(name); await fs.rm(path.join(this.p, name), { recursive: Boolean(options.recursive) }); }
  async *entries() {
    for (const item of await fs.readdir(this.p, { withFileTypes: true })) yield [item.name, item.isDirectory() ? new DiskDir(path.join(this.p, item.name), this.state) : new DiskFile(path.join(this.p, item.name), this.state)];
  }
}
module.exports = { DiskDir, DiskFile, namedError };
