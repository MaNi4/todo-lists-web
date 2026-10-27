// The lists themselves: the same document, merge and changes as bin/todo-lists
// in the mani4.todo-lists Omarchy plugin ("The document", "records",
// "changes", "locked lists" and "the view" there are the reference).
//
//   {"v": 1,
//    "lists": {id: {"name", "pos", "updated", "by", "deleted"?, "lock"?,
//                   "oldLocks"?, "at"}},
//    "items": {id: {"list", "text" | "sealed" and "k", "done", "completed"?,
//                   "pos", "updated", "by", "deleted"?, "at"}}}
//
// Each record keeps, per group of its fields, when they last changed
// ("at": {group: [ms, device]}); a merge keeps the later change of each
// group. A removal wins. Removed records stay as tombstones for 90 days.

import * as C from "./crypto.js"

export const MAX_LISTS = 50
export const MAX_ITEMS = 1000
export const MAX_NAME = 60
export const MAX_TEXT = 500
export const MAX_OLD_LOCKS = 10
const KEEP_TOMBSTONES = 90 * 86400 * 1000
export const LIST_GROUPS = { name: ["name"], pos: ["pos"], lock: ["lock"], color: ["color"] }
// A list's color, by name; one without gets one from its id.
export const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray"]
export function colorOf(lid, color) {
  if (COLORS.includes(color)) return color
  let h = 0
  for (const c of lid) h = (h * 31 + c.charCodeAt(0)) % 9973
  return COLORS[h % (COLORS.length - 1)]
}
export const ITEM_GROUPS = { text: ["text", "sealed", "k"], done: ["done", "completed"], pos: ["pos"] }
const ID = /^[0-9a-f]{8,32}$/

// One line of text: no control characters, no surrounding space.
export function clean(text, limit) {
  if (typeof text !== "string") return ""
  const kept = [...text].filter(c => c === "\t" || c === "\r" || c === "\n" || (c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127))
    .map(c => (c === "\t" || c === "\r" || c === "\n" ? " " : c)).join("")
  return [...kept.split(/\s+/).filter(Boolean).join(" ")].slice(0, limit).join("")
}

function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

export function emptyDoc() {
  return { v: 1, lists: {}, items: {} }
}

// A list's lock: {"id", "kdf", "pw", "rec", "rp"?} (version 1 locks, from the
// plugin's first builds, are kept as they are; they open on the computer).
export function cleanLock(lock) {
  if (!lock || typeof lock !== "object") return null
  const id = typeof lock.id === "string" ? lock.id : lock.salt
  if (typeof id !== "string" || !id) return null
  const kdf = C.cleanKdf(lock.kdf)
  const rec = lock.rec && typeof lock.rec === "object" ? lock.rec : {}
  if (kdf && typeof lock.pw === "string" && typeof rec.epk === "string" && typeof rec.ct === "string") {
    const out = { id: id.slice(0, 64), kdf, pw: lock.pw.slice(0, 256), rec: { epk: rec.epk.slice(0, 256), ct: rec.ct.slice(0, 256) } }
    if (typeof lock.rp === "string") out.rp = lock.rp.slice(0, 32)
    return out
  }
  if (typeof lock.salt === "string" && typeof lock.check === "string" && Number.isInteger(lock.iter))
    return { id: lock.salt.slice(0, 64), salt: lock.salt.slice(0, 64), iter: lock.iter, check: lock.check.slice(0, 256) }
  return null
}

function cleanAt(rec, raw, groups) {
  const at = raw.at && typeof raw.at === "object" ? raw.at : {}
  const out = {}
  for (const g of Object.keys(groups)) {
    const v = at[g]
    out[g] = Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === "string"
      ? [v[0], v[1].slice(0, 32)] : [rec.updated, rec.by]
  }
  return out
}

// The document as the plugin writes it, whatever was found in it.
export function tidy(doc) {
  const out = emptyDoc()
  if (!doc || typeof doc !== "object") return out
  const lists = doc.lists && typeof doc.lists === "object" ? doc.lists : {}
  const items = doc.items && typeof doc.items === "object" ? doc.items : {}
  for (const [lid, l] of Object.entries(lists).slice(0, MAX_LISTS * 4)) {
    if (!ID.test(lid) || !l || typeof l !== "object") continue
    const rec = { updated: Math.trunc(num(l.updated)), by: String(l.by || "").slice(0, 32) }
    if (l.deleted === true) rec.deleted = true
    else {
      rec.name = clean(l.name, MAX_NAME) || "List"
      rec.pos = num(l.pos)
      if (COLORS.includes(l.color)) rec.color = l.color
      const lock = cleanLock(l.lock)
      if (lock) rec.lock = lock
      const olds = (Array.isArray(l.oldLocks) ? l.oldLocks : []).map(cleanLock)
        .filter(o => o && (!lock || o.id !== lock.id)).slice(0, MAX_OLD_LOCKS)
      if (olds.length) rec.oldLocks = olds
      rec.at = cleanAt(rec, l, LIST_GROUPS)
    }
    out.lists[lid] = rec
  }
  for (const [iid, it] of Object.entries(items).slice(0, MAX_LISTS * MAX_ITEMS * 2)) {
    if (!ID.test(iid) || !it || typeof it !== "object") continue
    const rec = { list: String(it.list || "").slice(0, 32), updated: Math.trunc(num(it.updated)), by: String(it.by || "").slice(0, 32) }
    if (it.deleted === true) rec.deleted = true
    else {
      if (typeof it.sealed === "string") {
        rec.sealed = it.sealed.slice(0, 4096)
        let k = it.k
        if (typeof k !== "string") k = ((out.lists[rec.list] || {}).lock || {}).id || ""
        rec.k = k.slice(0, 64)
      } else {
        const text = clean(it.text, MAX_TEXT)
        if (!text) continue
        rec.text = text
      }
      rec.done = it.done === true
      rec.pos = num(it.pos)
      if (rec.done) rec.completed = Math.trunc(num(it.completed)) || rec.updated
      rec.at = cleanAt(rec, it, ITEM_GROUPS)
    }
    out.items[iid] = rec
  }
  return out
}

function cmp(a, b) {
  // [ms, device] pairs, as Python compares tuples.
  if (a[0] !== b[0]) return a[0] > b[0] ? 1 : -1
  return a[1] === b[1] ? 0 : a[1] > b[1] ? 1 : -1
}

function newer(a, b) {
  return cmp([a.updated || 0, a.by || ""], [b.updated || 0, b.by || ""]) > 0
}

function mergeRecord(x, y, groups, isList) {
  if (x.deleted || y.deleted) {
    if (x.deleted && y.deleted) return { ...(newer(y, x) ? y : x) }
    return { ...(x.deleted ? x : y) }
  }
  const out = {}
  if ("list" in x) out.list = x.list
  const at = {}
  for (const [g, keys] of Object.entries(groups)) {
    const ax = x.at[g], ay = y.at[g]
    const src = cmp(ax, ay) >= 0 ? x : y
    for (const k of keys) if (k in src) out[k] = src[k]
    at[g] = cmp(ax, ay) >= 0 ? [...ax] : [...ay]
  }
  if (isList) {
    const olds = {}
    for (const o of [...(x.oldLocks || []), ...(y.oldLocks || [])]) olds[o.id] = o
    const current = (out.lock || {}).id
    const keep = Object.keys(olds).sort().filter(k => k !== current).map(k => olds[k]).slice(0, MAX_OLD_LOCKS)
    if (keep.length) out.oldLocks = keep
  }
  out.at = at
  const top = Object.values(at).reduce((a, b) => (cmp(a, b) >= 0 ? a : b))
  out.updated = top[0]
  out.by = top[1]
  return out
}

// Both devices' changes, record by record and field by field.
export function merge(a, b) {
  const out = emptyDoc()
  for (const [part, groups] of [["lists", LIST_GROUPS], ["items", ITEM_GROUPS]]) {
    out[part] = { ...a[part] }
    for (const [rid, rec] of Object.entries(b[part])) {
      const mine = out[part][rid]
      out[part][rid] = mine === undefined ? rec : mergeRecord(mine, rec, groups, part === "lists")
    }
  }
  return out
}

export function prune(doc, now) {
  for (const part of ["lists", "items"])
    for (const [rid, rec] of Object.entries(doc[part]))
      if (rec.deleted && now - (rec.updated || 0) > KEEP_TOMBSTONES) delete doc[part][rid]
}

export function same(a, b) {
  return C.canonical(a) === C.canonical(b)
}

// ---------- the model: a document and the keys this device holds ----------

export class Model {
  constructor(doc, header, device) {
    this.doc = doc
    this.header = header
    this.device = device
    this.listKeys = new Map() // list id -> {id: lock id, key: raw bytes}, until locked again
    this.oldKeys = new Map()  // lock id -> raw key, of locks a list had before
    this.notice = null
  }

  say(ok, text) {
    this.notice = { id: Date.now(), ok, text }
    return ok
  }

  stamp(rec, groups = []) {
    const t = Math.max(Date.now(), (rec.updated || 0) + 1)
    for (const g of groups) (rec.at || (rec.at = {}))[g] = [t, this.device]
    rec.updated = t
    rec.by = this.device
    return rec
  }

  newId() {
    for (;;) {
      const id = C.randomHex(8)
      if (!(id in this.doc.lists) && !(id in this.doc.items)) return id
    }
  }

  liveLists() {
    return Object.entries(this.doc.lists).filter(([, l]) => !l.deleted)
      .sort((a, b) => a[1].pos - b[1].pos || (a[0] < b[0] ? -1 : 1))
  }

  liveItems(lid) {
    return Object.entries(this.doc.items).filter(([, it]) => it.list === lid && !it.deleted)
  }

  openItems(lid) {
    return this.liveItems(lid).filter(([, it]) => !it.done)
      .sort((a, b) => a[1].pos - b[1].pos || (a[0] < b[0] ? -1 : 1))
  }

  addList(name) {
    const lists = this.liveLists()
    if (!name || lists.length >= MAX_LISTS) return false
    const pos = lists.length ? lists[lists.length - 1][1].pos + 1 : 1
    this.doc.lists[this.newId()] = this.stamp({ name, pos }, Object.keys(LIST_GROUPS))
    return true
  }

  // ----- keys of locked lists -----
  currentKey(lid) {
    const lock = (this.doc.lists[lid] || {}).lock
    const entry = this.listKeys.get(lid)
    return lock && entry && entry.id === lock.id ? entry.key : null
  }

  keyFor(lid, lockId) {
    const entry = this.listKeys.get(lid)
    if (entry && entry.id === lockId) return entry.key
    return this.oldKeys.get(lockId) || null
  }

  async itemText(lid, it) {
    if (!("sealed" in it)) return it.text || ""
    const key = this.keyFor(lid, it.k || "")
    if (!key) return null
    try {
      const data = await C.unseal(key, C.b64d(it.sealed), C.L.list)
      return data ? clean(JSON.parse(C.decodeText(data)).text, MAX_TEXT) : null
    } catch {
      return null
    }
  }

  isStale(lid, it) {
    const lock = (this.doc.lists[lid] || {}).lock
    return "sealed" in it && (!lock || it.k !== lock.id)
  }

  async setText(lid, rec, text) {
    const lst = this.doc.lists[lid]
    if (lst.lock) {
      delete rec.text
      rec.sealed = C.b64e(await C.seal(this.currentKey(lid), C.encodeText(JSON.stringify({ text })), C.L.list))
      rec.k = lst.lock.id
    } else {
      delete rec.sealed
      delete rec.k
      rec.text = text
    }
  }

  // After a merge: a key kept for a lock its list no longer has is an old
  // key now; then whatever old keys open is sealed again.
  async settleKeys() {
    for (const [lid, entry] of [...this.listKeys]) {
      const lock = (this.doc.lists[lid] || {}).lock
      if (!lock || lock.id !== entry.id) {
        this.oldKeys.set(entry.id, entry.key)
        this.listKeys.delete(lid)
      }
    }
    return this.healAll()
  }

  async heal(lid) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted) return false
    if (lst.lock && !this.currentKey(lid)) return false
    let changed = false
    for (const [, it] of this.liveItems(lid)) {
      if (!this.isStale(lid, it)) continue
      const text = await this.itemText(lid, it)
      if (text === null) continue
      await this.setText(lid, it, text)
      this.stamp(it, ["text"])
      changed = true
    }
    return changed
  }

  async healAll() {
    let changed = false
    for (const [lid] of this.liveLists()) if (await this.heal(lid)) changed = true
    return changed
  }

  // ----- changes -----
  renumber(records) {
    records.forEach(([, rec], n) => { rec.pos = n + 1; this.stamp(rec, ["pos"]) })
  }

  place(records, rec, at) {
    const before = at > 0 ? records[at - 1][1].pos : null
    const after = at < records.length ? records[at][1].pos : null
    if (before === null && after === null) rec.pos = 1
    else if (before === null) rec.pos = after - 1
    else if (after === null) rec.pos = before + 1
    else if (after - before > 1e-6) rec.pos = (before + after) / 2
    else {
      this.renumber([...records.slice(0, at), [null, rec], ...records.slice(at)])
      return
    }
    this.stamp(rec, ["pos"])
  }

  tombstone(rec) {
    for (const k of Object.keys(rec)) if (!["list", "updated", "by"].includes(k)) delete rec[k]
    rec.deleted = true
    this.stamp(rec)
  }

  // One change; true when something changed.
  async apply(op) {
    if (!op || typeof op !== "object") return false
    const kind = op.op
    if (kind === "addList") return this.addList(clean(op.name, MAX_NAME))
    const lid = op.list
    const lst = typeof lid === "string" ? this.doc.lists[lid] : null
    if (!lst || lst.deleted) return false
    const locked = !!lst.lock && !this.currentKey(lid)
    const by = v => Math.trunc(num(v))
    if (kind === "renameList") {
      const name = clean(op.name, MAX_NAME)
      if (!name || name === lst.name) return false
      lst.name = name
      this.stamp(lst, ["name"])
      return true
    }
    if (kind === "colorList") {
      if (!COLORS.includes(op.color) || op.color === lst.color) return false
      lst.color = op.color
      this.stamp(lst, ["color"])
      return true
    }
    if (kind === "moveList") {
      const lists = this.liveLists()
      const at = lists.findIndex(([id]) => id === lid)
      const to = Math.max(0, Math.min(lists.length - 1, at + Math.max(-100, Math.min(100, by(op.by)))))
      if (to === at) return false
      this.place(lists.filter(([id]) => id !== lid), lst, to)
      return true
    }
    if (kind === "removeList") {
      if (locked) return false
      for (const [, it] of this.liveItems(lid)) this.tombstone(it)
      this.tombstone(lst)
      if (!this.liveLists().length) this.addList("To-Do")
      this.listKeys.delete(lid)
      return true
    }
    if (kind === "removeStale") {
      const stale = []
      for (const [, it] of this.liveItems(lid)) if (this.isStale(lid, it) && (await this.itemText(lid, it)) === null) stale.push(it)
      stale.forEach(it => this.tombstone(it))
      return stale.length > 0
    }
    if (locked) return false
    if (kind === "add") {
      const text = clean(op.text, MAX_TEXT)
      if (!text || this.liveItems(lid).length >= MAX_ITEMS) return false
      const rec = { list: lid, done: false }
      await this.setText(lid, rec, text)
      const opened = this.openItems(lid)
      rec.pos = opened.length ? opened[opened.length - 1][1].pos + 1 : 1
      this.doc.items[this.newId()] = this.stamp(rec, Object.keys(ITEM_GROUPS))
      return true
    }
    if (kind === "clearDone") {
      const done = this.liveItems(lid).filter(([, it]) => it.done)
      done.forEach(([, it]) => this.tombstone(it))
      return done.length > 0
    }
    const iid = op.item
    const it = typeof iid === "string" ? this.doc.items[iid] : null
    if (!it || it.deleted || it.list !== lid) return false
    if (kind === "edit") {
      const text = clean(op.text, MAX_TEXT)
      if (!text || text === (await this.itemText(lid, it))) return false
      await this.setText(lid, it, text)
      this.stamp(it, ["text"])
      return true
    }
    if (kind === "done") {
      const done = op.done === true
      if (done === it.done) return false
      it.done = done
      if (done) {
        it.completed = Date.now()
        this.stamp(it, ["done"])
      } else {
        delete it.completed
        const opened = this.openItems(lid)
        it.pos = opened.length ? opened[opened.length - 1][1].pos + 1 : 1
        this.stamp(it, ["done", "pos"])
      }
      return true
    }
    if (kind === "remove") {
      this.tombstone(it)
      return true
    }
    if (kind === "moveTo") {
      // To another list, at the end of its open to-dos (or at `at`): a new
      // record there (sealed with that list's key, when it is locked) and
      // this one gone, in one change. A locked list it goes to must be open.
      // `as` names the new record, so Undo can find it.
      const to = op.to
      const dest = typeof to === "string" ? this.doc.lists[to] : null
      if (!dest || dest.deleted || to === lid) return false
      if (dest.lock && !this.currentKey(to)) return false
      const text = await this.itemText(lid, it)
      if (text === null || this.liveItems(to).length >= MAX_ITEMS) return false
      const rec = { list: to, done: it.done }
      if (it.done && "completed" in it) rec.completed = it.completed
      await this.setText(to, rec, text)
      const opened = this.openItems(to)
      if (!it.done && typeof op.at === "number" && Number.isFinite(op.at))
        this.place(opened, rec, Math.max(0, Math.min(opened.length, Math.trunc(op.at))))
      else rec.pos = opened.length ? opened[opened.length - 1][1].pos + 1 : 1
      const fresh = typeof op.as === "string" && /^[0-9a-f]{16}$/.test(op.as) && !(op.as in this.doc.items) && !(op.as in this.doc.lists)
      this.doc.items[fresh ? op.as : this.newId()] = this.stamp(rec, Object.keys(ITEM_GROUPS))
      this.tombstone(it)
      return true
    }
    if (kind === "move") {
      if (it.done) return false
      const opened = this.openItems(lid)
      const at = opened.findIndex(([id]) => id === iid)
      const to = at + Math.max(-1000, Math.min(1000, by(op.by)))
      if (to === at || to < 0 || to >= opened.length) return false
      this.place(opened.filter(([id]) => id !== iid), it, to)
      return true
    }
    return false
  }

  // ----- locked lists -----
  async lockKey(lock, password) {
    if (!("kdf" in lock)) return null // a version 1 lock: open it on the computer once
    try {
      return await C.unseal(await C.derive(password, lock.kdf), C.b64d(lock.pw), C.L.listPassword)
    } catch {
      return null
    }
  }

  async lockKeyByRecovery(lock, code) {
    if (!lock.rec) return null
    const priv = await C.recoveryPrivate(this.header, code)
    return priv ? C.unwrapWith(priv, lock.rec, C.L.recWrap) : null
  }

  async newLock(key, lockId, password) {
    const kdf = C.newKdf()
    const pub = C.b64d(this.header.recovery.pub)
    return {
      id: lockId, kdf, pw: C.b64e(await C.seal(await C.derive(password, kdf), key, C.L.listPassword)),
      rec: await C.wrapTo(pub, key, C.L.recWrap), rp: await C.recoveryId(this.header),
    }
  }

  async rewrapForRecovery(lst, key) {
    const lock = lst.lock
    const rp = await C.recoveryId(this.header)
    if (!("kdf" in lock) || lock.rp === rp) return false
    lock.rec = await C.wrapTo(C.b64d(this.header.recovery.pub), key, C.L.recWrap)
    lock.rp = rp
    this.stamp(lst, ["lock"])
    return true
  }

  // Shows a locked list; whether to-dos changed.
  async unlockList(lid, password) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted || !lst.lock) return false
    if (!("kdf" in lst.lock)) return this.say(false, "This lock is from an older version: unlock it once on the computer")
    const key = await this.lockKey(lst.lock, password)
    if (!key) return this.say(false, "Wrong list password")
    this.listKeys.set(lid, { id: lst.lock.id, key })
    const rewrapped = await this.rewrapForRecovery(lst, key)
    return (await this.heal(lid)) || rewrapped
  }

  async recoverList(lid, code, password) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted || !lst.lock) return false
    if (password) {
      const problem = C.passwordProblem(password, C.MIN_LIST_PASSWORD)
      if (problem) return this.say(false, problem)
    }
    const key = await this.lockKeyByRecovery(lst.lock, code)
    if (!key) return this.say(false, lst.lock.rec ? "Wrong recovery key" : "This lock is older than recovery keys")
    this.listKeys.set(lid, { id: lst.lock.id, key })
    if (password) {
      lst.lock = await this.newLock(key, lst.lock.id, password)
      this.stamp(lst, ["lock"])
      await this.heal(lid)
      return this.say(true, "A new list password is set")
    }
    await this.removeLock(lid)
    return true
  }

  async changeListPassword(lid, password) {
    const lst = this.doc.lists[lid]
    const key = this.currentKey(lid)
    if (!lst || lst.deleted || !key) return false
    const problem = C.passwordProblem(password, C.MIN_LIST_PASSWORD)
    if (problem) return this.say(false, problem)
    lst.lock = await this.newLock(key, lst.lock.id, password)
    this.stamp(lst, ["lock"])
    return this.say(true, "The list password is changed")
  }

  async unlockOld(lid, secret) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted) return false
    const wanted = new Set(this.liveItems(lid).filter(([, it]) => this.isStale(lid, it)).map(([, it]) => it.k))
    const byRecovery = C.parseRecovery(secret) !== null
    let found = false
    for (const lock of lst.oldLocks || []) {
      if (!wanted.has(lock.id) || this.oldKeys.has(lock.id)) continue
      const key = byRecovery ? await this.lockKeyByRecovery(lock, secret) : await this.lockKey(lock, secret)
      if (key) { this.oldKeys.set(lock.id, key); found = true }
    }
    if (!found) return this.say(false, "No older list password of this list matches")
    const healed = await this.heal(lid)
    this.say(true, lst.lock ? "Opened and sealed again with the list password" : "Opened")
    return healed
  }

  async setLock(lid, password) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted || lst.lock) return false
    const problem = C.passwordProblem(password, C.MIN_LIST_PASSWORD)
    if (problem) return this.say(false, problem)
    const key = C.randomBytes(32)
    lst.lock = await this.newLock(key, C.b64e(C.randomBytes(12)), password)
    this.stamp(lst, ["lock"])
    this.listKeys.set(lid, { id: lst.lock.id, key })
    for (const [, it] of this.liveItems(lid)) {
      if (!("sealed" in it)) {
        await this.setText(lid, it, it.text || "")
        this.stamp(it, ["text"])
      }
    }
    await this.heal(lid)
    return this.say(true, "Locked; it stays open until you lock the lists again")
  }

  async removeLock(lid) {
    const lst = this.doc.lists[lid]
    if (!lst || lst.deleted || !lst.lock || !this.currentKey(lid)) return false
    const lock = lst.lock
    this.oldKeys.set(lock.id, this.currentKey(lid))
    const olds = (lst.oldLocks || []).filter(o => o.id !== lock.id)
    lst.oldLocks = [...olds, lock].slice(-MAX_OLD_LOCKS)
    delete lst.lock
    this.stamp(lst, ["lock"])
    this.listKeys.delete(lid)
    await this.heal(lid)
    return this.say(true, "The lock is off")
  }

  lockAll() {
    this.listKeys.clear()
    this.oldKeys.clear()
  }

  // ----- the view -----
  async view() {
    const out = []
    const rp = await C.recoveryId(this.header)
    for (const [lid, l] of this.liveLists()) {
      const lock = !!l.lock
      const shown = !lock || !!this.currentKey(lid)
      const items = []
      let open = 0
      let stale = 0
      for (const [iid, it] of this.liveItems(lid)) {
        if (!it.done) open++
        if (!shown) continue
        const text = await this.itemText(lid, it)
        if (text === null) { stale++; continue }
        items.push({ id: iid, text, done: it.done, pos: it.pos, completed: it.completed || 0 })
      }
      items.sort((a, b) => (a.done - b.done) || (a.done ? b.completed - a.completed : a.pos - b.pos) || (a.id < b.id ? -1 : 1))
      out.push({
        id: lid, name: l.name, color: colorOf(lid, l.color), locked: lock, unlocked: lock && shown, open, stale,
        recoverable: lock && !!l.lock.rec && l.lock.rp === rp,
        oldLock: lock && !("kdf" in l.lock),
        items: shown ? items.map(({ pos, ...rest }) => rest) : null,
      })
    }
    return out
  }
}

// The lists as Markdown, to keep or read anywhere: a heading per list and a
// check box per to-do. A locked list not unlocked is named, not shown. The
// same text as the plugin's export.
export function markdown(lists, day) {
  const out = ["# To-Do Lists", "", "_Exported " + day + "_"]
  for (const l of lists) {
    out.push("", "## " + l.name, "")
    if (l.items === null) { out.push("_Locked: unlock it, then export again to include it._"); continue }
    if (!l.items.length) out.push("_Nothing to do._")
    for (const it of l.items) out.push("- [" + (it.done ? "x" : " ") + "] " + it.text)
  }
  return out.join("\n") + "\n"
}
