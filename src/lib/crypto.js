// The encryption of the To-Do Lists file, the same as bin/todo-lists in the
// mani4.todo-lists Omarchy plugin (its "Crypto" section is the reference).
//
// The file (version 3):
//   {"format": "mani4.todo-lists", "v": 3,
//    "header": {"at": ms,
//               "password": {"kdf": KDF, "wrapped": b64},
//               "recovery": {"salt": b64, "pub": b64, "private": b64,
//                            "wrapped": {"epk": b64, "ct": b64}}},
//    "iv": b64, "ct": b64}
//
// The document is sealed (AES-256-GCM) with a random data key. The header
// wraps that key with a key derived from the master password (Argon2id,
// KDF = {"name": "Argon2id", "t", "m" (KiB), "p", "salt"}; the salt is the
// base64 text itself), and for the recovery key: to a P-256 public key
// (ECDH, HKDF-SHA256, AES-256-GCM) whose private key is sealed with a key
// derived from the recovery key (HKDF-SHA256). Every sealed part carries a
// label of its own as associated data.

import { argon2id } from "hash-wasm"

const subtle = globalThis.crypto.subtle
const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

export const FORMAT = "mani4.todo-lists"
export const VERSION = 3
export const L = {
  doc: utf8.encode("mani4.todo-lists/v3/doc"),
  password: utf8.encode("mani4.todo-lists/v3/password"),
  recPrivate: utf8.encode("mani4.todo-lists/v3/recovery-private"),
  recWrap: utf8.encode("mani4.todo-lists/v3/recovery-wrap"),
  listPassword: utf8.encode("mani4.todo-lists/v3/list-password"),
  list: utf8.encode("mani4.todo-lists/v3/list"),
  token: utf8.encode("mani4.todo-lists/v3/token"),
  header: utf8.encode("mani4.todo-lists/v3/header-mac"),
}
export const ARGON = { name: "Argon2id", t: 3, m: 65536, p: 1 }
export const MAX_PASSWORD_BYTES = 127
export const MIN_PASSWORD = 12
export const MIN_LIST_PASSWORD = 4
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const P256 = { name: "ECDH", namedCurve: "P-256" }

// ---------- bytes ----------

export function b64e(bytes) {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function b64d(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error("not base64")
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function concat(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function randomHex(nbytes) {
  return Array.from(randomBytes(nbytes), b => b.toString(16).padStart(2, "0")).join("")
}

export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export const encodeText = text => utf8.encode(text)
export const decodeText = bytes => fromUtf8.decode(bytes)

// ---------- keys from passwords ----------

export function newKdf() {
  return { ...ARGON, salt: b64e(randomBytes(16)).replace(/=+$/, "") }
}

// A key derivation as the plugin makes them, or null.
export function cleanKdf(k) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
  // A file sets these; no more than 256 MiB and 6 passes, so a file changed
  // on GitHub cannot freeze the phone that opens it.
  if (k && k.name === "Argon2id" && int(k.t, 1, 6) && int(k.m, 8192, 262144) && int(k.p, 1, 4)
      && typeof k.salt === "string" && /^[A-Za-z0-9+/]{11,64}$/.test(k.salt))
    return { name: "Argon2id", t: k.t, m: k.m, p: k.p, salt: k.salt }
  return null
}

export async function derive(password, kdf) {
  if (!kdf || kdf.name !== "Argon2id") throw new Error("This file needs a newer To-Do Lists")
  const bytes = utf8.encode(password)
  if (bytes.length > MAX_PASSWORD_BYTES) throw new Error("The password is too long")
  return argon2id({
    password: bytes, salt: utf8.encode(kdf.salt), parallelism: kdf.p, iterations: kdf.t,
    memorySize: kdf.m, hashLength: 32, outputType: "binary",
  })
}

// Why a new password will not do, or "".
export function passwordProblem(password, minimum) {
  if ([...password].length < minimum) return `Use at least ${minimum} characters`
  if (utf8.encode(password).length > MAX_PASSWORD_BYTES) return `Use at most ${MAX_PASSWORD_BYTES} bytes`
  return ""
}

// ---------- sealing ----------

// A raw key (bytes) or a CryptoKey (the remembered data key) for AES-GCM.
async function aesKey(key) {
  if (key instanceof CryptoKey) return key
  return subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function importDataKey(raw, extractable = false) {
  return subtle.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"])
}

export async function seal(key, data, aad) {
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aesKey(key), data)
  return concat(iv, new Uint8Array(ct))
}

// The data, or null when the key is wrong or the blob was changed.
export async function unseal(key, blob, aad) {
  if (!key || !blob || blob.length < 12 + 16) return null
  try {
    const data = await subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12), additionalData: aad }, await aesKey(key), blob.slice(12))
    return new Uint8Array(data)
  } catch {
    return null
  }
}

export async function hkdf(ikm, salt, info) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, 256))
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await subtle.digest("SHA-256", utf8.encode(text)))
  return Array.from(d, b => b.toString(16).padStart(2, "0")).join("")
}

// ---------- the recovery key ----------

// 160 random bits as 32 Crockford base32 characters, in eight groups of four.
export function recoveryCode() {
  const raw = randomBytes(20)
  let n = 0n
  for (const b of raw) n = (n << 8n) | BigInt(b)
  let chars = ""
  for (let i = 31; i >= 0; i--) chars += CROCKFORD[Number((n >> BigInt(5 * i)) & 31n)]
  return { code: chars.match(/.{4}/g).join("-"), raw }
}

// The bytes of a recovery key as typed (any case, dashes or spaces, O for
// 0, I or L for 1), or null.
export function parseRecovery(text) {
  const t = String(text || "").replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1")
  if (t.length !== 32 || [...t].some(c => !CROCKFORD.includes(c))) return null
  let n = 0n
  for (const c of t) n = n * 32n + BigInt(CROCKFORD.indexOf(c))
  const out = new Uint8Array(20)
  for (let i = 19; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n }
  return out
}

// secret for whoever has the private key of pubRaw.
export async function wrapTo(pubRaw, secret, aad) {
  const eph = await subtle.generateKey(P256, true, ["deriveBits"])
  const epk = new Uint8Array(await subtle.exportKey("raw", eph.publicKey))
  const pub = await subtle.importKey("raw", pubRaw, P256, false, [])
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256))
  return { epk: b64e(epk), ct: b64e(await seal(await hkdf(shared, epk, aad), secret, aad)) }
}

export async function unwrapWith(priv, wrap, aad) {
  try {
    const epk = b64d(wrap.epk)
    const pub = await subtle.importKey("raw", epk, P256, false, [])
    const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256))
    return await unseal(await hkdf(shared, epk, aad), b64d(wrap.ct), aad)
  } catch {
    return null
  }
}

// ---------- the header ----------

export async function passwordBlock(dek, password) {
  const kdf = newKdf()
  return { kdf, wrapped: b64e(await seal(await derive(password, kdf), dek, L.password)) }
}

// A new recovery key for a data key: the header's block, and the key.
export async function recoveryBlock(dek) {
  const { code, raw } = recoveryCode()
  const rsalt = randomBytes(16)
  const pair = await subtle.generateKey(P256, true, ["deriveBits"])
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey))
  const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey))
  const block = {
    salt: b64e(rsalt), pub: b64e(pub),
    private: b64e(await seal(await hkdf(raw, rsalt, L.recPrivate), pkcs8, L.recPrivate)),
    wrapped: await wrapTo(pub, dek, L.recWrap),
  }
  return { block, code }
}

export async function newHeader(dek, password) {
  const { block, code } = await recoveryBlock(dek)
  return { header: { at: Date.now(), password: await passwordBlock(dek, password), recovery: block }, code }
}

// ---------- the header's signature ----------
// HMAC-SHA256 of the header's JSON (without "mac"), with a key derived from
// the data key: only a device that holds the data key can make it, so a
// header changed by anyone else is refused. The key is derived while the
// data key is at hand (unlocking), and kept as a key that cannot be read
// back out, like the data key.

export async function macKeyFrom(dek) {
  const raw = await hkdf(dek, new Uint8Array(0), L.header)
  return subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

export const unsigned = header => Object.fromEntries(Object.entries(header).filter(([k]) => k !== "mac"))

export async function headerMac(macKey, header) {
  return b64e(new Uint8Array(await subtle.sign("HMAC", macKey, utf8.encode(canonical(unsigned(header))))))
}

// Signed with this data key; or, from before headers were signed, unsigned
// and no newer than the header this device knows (never taken over then).
export async function headerOk(macKey, header, known = null) {
  if (typeof header.mac === "string") {
    try {
      return await subtle.verify("HMAC", macKey, b64d(header.mac), utf8.encode(canonical(unsigned(header))))
    } catch {
      return false
    }
  }
  return !!known && (header.at || 0) <= (known.at || 0)
}

// A short name of the header's recovery key, which a list's lock keeps to
// tell whether it is wrapped for this one.
export async function recoveryId(header) {
  return (await sha256Hex(header.recovery.pub)).slice(0, 16)
}

export function cleanHeader(h) {
  const pw = (h && h.password) || {}
  const rec = (h && h.recovery) || {}
  const wrapped = rec.wrapped || {}
  const kdf = cleanKdf(pw.kdf)
  const str = v => typeof v === "string"
  if (!kdf || !str(pw.wrapped) || !["salt", "pub", "private"].every(k => str(rec[k])) || !str(wrapped.epk) || !str(wrapped.ct))
    throw new Error("a broken header")
  const out = {
    at: Number.isInteger(h.at) ? h.at : 0,
    password: { kdf, wrapped: pw.wrapped.slice(0, 256) },
    recovery: { salt: rec.salt.slice(0, 64), pub: rec.pub.slice(0, 256), private: rec.private.slice(0, 1024),
                wrapped: { epk: wrapped.epk.slice(0, 256), ct: wrapped.ct.slice(0, 256) } },
  }
  if (str(h.mac)) out.mac = h.mac.slice(0, 64)
  return out
}

// The raw data key, opened with the master password, or null.
export async function dekFromPassword(header, password) {
  try {
    return await unseal(await derive(password, header.password.kdf), b64d(header.password.wrapped), L.password)
  } catch {
    return null
  }
}

// The recovery private key, opened with a recovery key, or null.
export async function recoveryPrivate(header, code) {
  const raw = parseRecovery(code)
  if (!raw) return null
  try {
    const rec = header.recovery
    const pkcs8 = await unseal(await hkdf(raw, b64d(rec.salt), L.recPrivate), b64d(rec.private), L.recPrivate)
    return pkcs8 ? await subtle.importKey("pkcs8", pkcs8, P256, false, ["deriveBits"]) : null
  } catch {
    return null
  }
}

export async function dekFromRecovery(header, code) {
  const priv = await recoveryPrivate(header, code)
  return priv ? unwrapWith(priv, header.recovery.wrapped, L.recWrap) : null
}

// ---------- the envelope ----------

// JSON with its keys in order, so two equal documents read the same.
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}"
  return JSON.stringify(value)
}

export async function envelope(doc, dek, header, macKey) {
  const blob = await seal(dek, utf8.encode(canonical(doc)), L.doc)
  const signed = { ...unsigned(header), mac: await headerMac(macKey, header) }
  return { format: FORMAT, v: VERSION, header: signed, iv: b64e(blob.slice(0, 12)), ct: b64e(blob.slice(12)) }
}

export function checkEnvelope(env) {
  if (!env || typeof env !== "object") throw new Error("not a To-Do Lists file")
  if (env.format === "mani4.reminders")
    throw new Error("This file is in an older version: open the To-Do Lists panel on the computer once to update it")
  if (env.format !== FORMAT) throw new Error("not a To-Do Lists file")
  if (env.v !== VERSION) throw new Error("This file needs a newer version of this app")
  return env
}

// The document's JSON in an envelope, or null when the key does not open it.
export async function openEnvelope(env, dek) {
  try {
    const data = await unseal(dek, concat(b64d(env.iv), b64d(env.ct)), L.doc)
    return data ? JSON.parse(fromUtf8.decode(data)) : null
  } catch {
    return null
  }
}
