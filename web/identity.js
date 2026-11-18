/* Töre kimliği: özel anahtar ve parola sunucuya gönderilmez, tarayıcı deposu kullanılmaz. */
const enc = new TextEncoder();
const ITERATIONS = 310000;
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function fromBase64(value, length) {
  if (typeof value !== 'string' || value.length > 2048 || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Anahtar dosyasında geçersiz veri var.');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (toBase64(bytes) !== value || (length !== undefined && bytes.length !== length)) throw new Error('Anahtar dosyasında geçersiz alan uzunluğu var.');
  return bytes;
}
function keyId(raw) { return toBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function requireCrypto() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) throw new Error('Bu tarayıcıda güvenli kimlik işlemleri kullanılamıyor. Töre’yi bu bilgisayardaki yerel adresinden Chrome ile açın.');
}
function passphraseText(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024) throw new Error('Anahtar dosyası için en az 12 karakterlik bir parola kullanın.');
}
async function encryptionKey(passphrase, salt, usage) {
  const password = enc.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
  } finally { password.fill(0); }
}
async function publicIdentity(privateKey, rawPublicKey, recoveryFile) {
  const publicKey = await crypto.subtle.importKey('raw', rawPublicKey, 'Ed25519', false, ['verify']);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign('Ed25519', privateKey, challenge);
  if (!await crypto.subtle.verify('Ed25519', publicKey, signature, challenge)) throw new Error('Anahtar dosyasının açık ve özel anahtarı eşleşmiyor.');
  return { id: keyId(rawPublicKey), publicKey: toBase64(rawPublicKey), privateKey, recoveryFile };
}
export async function createIdentity(passphrase) {
  requireCrypto(); passphraseText(passphrase);
  let pair;
  try { pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']); }
  catch { throw new Error('Bu tarayıcı Ed25519 anahtarlarını desteklemiyor. Güncel masaüstü Chrome kullanın.'); }
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await encryptionKey(passphrase, salt, 'encrypt');
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privateBytes));
    const recoveryFile = { format: 'tore-key', version: 1, publicKey: toBase64(rawPublicKey), salt: toBase64(salt), iv: toBase64(iv), iterations: ITERATIONS, ciphertext: toBase64(ciphertext) };
    const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, 'Ed25519', false, ['sign']);
    pair = null;
    return await publicIdentity(privateKey, rawPublicKey, recoveryFile);
  } finally { privateBytes.fill(0); }
}
export async function unlockIdentity(input, passphrase) {
  requireCrypto();
  if (typeof passphrase !== 'string' || !passphrase || passphrase.length > 1024) throw new Error('Anahtar dosyasının parolasını girin.');
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('Seçilen dosya geçerli bir Töre anahtar dosyası değil.'); }
  if (!exactKeys(value, ['format', 'version', 'publicKey', 'salt', 'iv', 'iterations', 'ciphertext']) || value.format !== 'tore-key' || value.version !== 1 || value.iterations !== ITERATIONS) throw new Error('Bu anahtar dosyasının biçimi veya sürümü desteklenmiyor.');
  const rawPublicKey = fromBase64(value.publicKey, 32), salt = fromBase64(value.salt, 16), iv = fromBase64(value.iv, 12), ciphertext = fromBase64(value.ciphertext);
  if (ciphertext.length < 48 || ciphertext.length > 512) throw new Error('Şifreli anahtar verisi geçersiz.');
  let privateBytes;
  try {
    const key = await encryptionKey(passphrase, salt, 'decrypt');
    try { privateBytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)); }
    catch { throw new Error('Parola yanlış veya anahtar dosyası bozulmuş.'); }
    let privateKey;
    try { privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, 'Ed25519', false, ['sign']); }
    catch { throw new Error('Dosyadaki özel anahtar geçerli değil.'); }
    return await publicIdentity(privateKey, rawPublicKey, { ...value });
  } finally { privateBytes?.fill(0); }
}
export async function signPayload(identity, exactPayload) {
  if (!identity?.privateKey || typeof exactPayload !== 'string') throw new Error('Önce kimliğinizi açın.');
  return toBase64(new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey, enc.encode(exactPayload))));
}
export function recoveryText(identity) {
  if (!identity?.recoveryFile) throw new Error('İndirilecek şifreli anahtar yok.');
  return JSON.stringify(identity.recoveryFile, null, 2) + '\n';
}
