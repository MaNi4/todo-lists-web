// The app's state and everything it does: connecting to the private GitHub
// repository, opening the file with the master password (or the recovery
// key), changes to the lists, and syncing. The views only read `state` and
// call these functions.

import { reactive, markRaw } from "vue"
import * as C from "./lib/crypto.js"
import * as db from "./lib/db.js"
import { GitHub, GitHubError } from "./lib/github.js"
import { Model, tidy, prune, emptyDoc } from "./lib/model.js"
import { syncRound } from "./lib/sync.js"

const SYNC_AFTER_CHANGE = 2000
const SYNC_EVERY = 60000
const RETRY_OFFLINE = 30000

export const state = reactive({
  phase: "loading",   // "loading", "connect", "locked", "ready", "error"
  error: "",
  lists: [],
  notice: null,
  busy: false,
  recovery: "",       // a new recovery key, shown until it is saved
  sync: { state: "off", last: 0, error: "" },
  settings: { repo: "", path: "todo-lists.enc", device: "" },
  remembered: false,
})

// Not reactive: keys and the model stay out of Vue's proxies.
const s = {
  model: null,
  dek: null,          // the data key: a CryptoKey
  mac: null,          // the header's signing key: a CryptoKey
  token: "",
  dirty: false,
  etag: null,
  syncing: false,
  timer: null,
  every: null,
  demo: false,
  gen: 0,             // counts changes, so one made during a sync is not lost
}

function say(ok, text) {
  state.notice = { id: Date.now(), ok, text }
  return ok
}

async function refresh() {
  if (s.model) state.lists = await s.model.view()
  if (s.model && s.model.notice) {
    state.notice = s.model.notice
    s.model.notice = null
  }
}

// ---------- keeping it here ----------

async function saveLocal() {
  if (s.demo) return
  prune(s.model.doc, Date.now())
  await db.set("envelope", await C.envelope(s.model.doc, s.dek, s.model.header, s.mac))
}

async function markDirty() {
  if (s.demo) return
  s.gen++
  s.dirty = true
  await db.set("dirty", true)
  scheduleSync(SYNC_AFTER_CHANGE)
}

async function sealToken(token) {
  await db.set("token", C.b64e(await C.seal(s.dek, C.encodeText(token), C.L.token)))
}

async function openToken() {
  const sealed = await db.get("token")
  if (!sealed) return ""
  const data = await C.unseal(s.dek, C.b64d(sealed), C.L.token)
  return data ? C.decodeText(data) : ""
}

async function opened(doc, dek, header, macKey, remember = true) {
  s.dek = markRaw(dek)
  s.mac = markRaw(macKey)
  s.model = markRaw(new Model(doc, header, state.settings.device))
  s.token = await openToken()
  if (remember) {
    await db.set("dek", s.dek)
    await db.set("mackey", s.mac)
    state.remembered = true
  }
  state.phase = "ready"
  state.sync.state = state.settings.repo ? (s.token ? "idle" : "error") : "off"
  state.sync.error = state.settings.repo && !s.token ? "The GitHub token is missing; connect again" : ""
  await refresh()
  startSyncing()
}

// ---------- starting ----------

// Development only (npm run dev, then #demo): the plugin's test file, opened
// in memory with its test password; nothing is saved and nothing synced.
async function demo() {
  const name = location.search.includes("en") ? "demo" : "plugin-v3"
  const fixture = await (await fetch(`/tests/fixtures/${name}.json`)).json()
  state.settings.device = "demo0001"
  const header = C.cleanHeader(fixture.env.header)
  const raw = await C.dekFromPassword(header, fixture.password)
  s.dek = markRaw(await C.importDataKey(raw))
  s.mac = markRaw(await C.macKeyFrom(raw))
  s.model = markRaw(new Model(tidy(await C.openEnvelope(fixture.env, raw)), header, "demo0001"))
  s.demo = true
  state.phase = "ready"
  await refresh()
}

export async function init() {
  if (import.meta.env.DEV && location.hash.startsWith("#demo")) return demo()
  try {
    const settings = (await db.get("settings")) || {}
    state.settings.device = settings.device || C.randomHex(4)
    state.settings.repo = settings.repo || ""
    state.settings.path = settings.path || "todo-lists.enc"
    if (!settings.device) await db.set("settings", { ...state.settings })
    s.dirty = !!(await db.get("dirty"))
    const env = await db.get("envelope")
    if (!env) { state.phase = "connect"; return }
    C.checkEnvelope(env)
    const dek = await db.get("dek")
    const macKey = await db.get("mackey")
    if (dek && macKey) {
      const doc = await C.openEnvelope(env, dek)
      const header = C.cleanHeader(env.header)
      if (doc && (!header.mac || await C.headerOk(macKey, header))) {
        await opened(tidy(doc), dek, header, macKey, false)
        state.remembered = true
        return
      }
    }
    state.phase = "locked"
  } catch (e) {
    state.phase = "error"
    state.error = String(e.message || e)
  }
}

function tidyRepo(repo) {
  repo = String(repo || "").trim().replace(/^(https?:\/\/)?github\.com\//, "").replace(/\/+$/, "").replace(/\.git$/, "")
  return /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ? repo : ""
}

// The phone's first step: the repository, a token, the master password.
// An empty repository starts new lists with that master password.
export async function connect({ repo, token, password }) {
  repo = tidyRepo(repo)
  token = String(token || "").trim()
  if (!repo) return say(false, "Repository: owner/name")
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) return say(false, "Paste a GitHub token")
  if (!password) return say(false, "Type the master password")
  state.busy = true
  try {
    const gh = new GitHub(repo, state.settings.path, token)
    const info = await gh.repoInfo()
    if (!info.private) return say(false, `${repo} is public; use a private repository`)
    const got = await gh.fetchFile()
    let doc, raw, header
    if (got.status === 200) {
      C.checkEnvelope(got.env)
      header = C.cleanHeader(got.env.header)
      raw = await C.dekFromPassword(header, password)
      const plain = raw && await C.openEnvelope(got.env, raw)
      if (!plain) return say(false, "Wrong master password for the file on GitHub")
      if (!(await C.headerOk(await C.macKeyFrom(raw), header)))
        return say(false, "The file on GitHub is not signed yet: open the To-Do Lists panel on the computer first")
      doc = tidy(plain)
      s.dirty = false
    } else {
      const problem = C.passwordProblem(password, C.MIN_PASSWORD)
      if (problem) return say(false, problem)
      raw = C.randomBytes(32)
      const made = await C.newHeader(raw, password)
      header = made.header
      state.recovery = made.code
      doc = emptyDoc()
      s.dirty = true
    }
    state.settings.repo = repo
    await db.set("settings", { ...state.settings })
    const dek = await C.importDataKey(raw)
    const macKey = await C.macKeyFrom(raw)
    s.dek = markRaw(dek)
    s.mac = markRaw(macKey)
    await sealToken(token)
    s.model = markRaw(new Model(doc, header, state.settings.device))
    if (got.status !== 200) s.model.addList("To-Do")
    await saveLocal()
    await db.set("dirty", s.dirty)
    await opened(s.model.doc, dek, header, macKey)
    return say(true, "Connected to " + repo)
  } catch (e) {
    return say(false, e instanceof GitHubError ? e.message : e instanceof TypeError ? "Couldn't reach GitHub" : String(e.message || e))
  } finally {
    state.busy = false
  }
}

export async function unlock(password) {
  state.busy = true
  try {
    const env = C.checkEnvelope(await db.get("envelope"))
    const header = C.cleanHeader(env.header)
    const raw = await C.dekFromPassword(header, password)
    const doc = raw && await C.openEnvelope(env, raw)
    if (!doc) return say(false, "Wrong master password")
    const macKey = await C.macKeyFrom(raw)
    if (header.mac && !(await C.headerOk(macKey, header))) return say(false, "The file's header was changed outside To-Do Lists")
    await opened(tidy(doc), await C.importDataKey(raw), header, macKey)
    if (!header.mac) await saveLocal()
    return true
  } catch (e) {
    return say(false, String(e.message || e))
  } finally {
    state.busy = false
  }
}

// A forgotten master password: the recovery key, and a new master password.
export async function recover(code, password) {
  const problem = C.passwordProblem(password, C.MIN_PASSWORD)
  if (problem) return say(false, problem)
  state.busy = true
  try {
    const env = C.checkEnvelope(await db.get("envelope"))
    const header = C.cleanHeader(env.header)
    const raw = await C.dekFromRecovery(header, code)
    const doc = raw && await C.openEnvelope(env, raw)
    if (!doc) return say(false, "Wrong recovery key")
    const macKey = await C.macKeyFrom(raw)
    if (header.mac && !(await C.headerOk(macKey, header))) return say(false, "The file's header was changed outside To-Do Lists")
    header.password = await C.passwordBlock(raw, password)
    header.at = Date.now()
    await opened(tidy(doc), await C.importDataKey(raw), header, macKey)
    await saveLocal()
    await markDirty()
    return say(true, "A new master password is set")
  } catch (e) {
    return say(false, String(e.message || e))
  } finally {
    state.busy = false
  }
}

// ---------- in the settings ----------

export async function changePassword(old, password) {
  const problem = C.passwordProblem(password, C.MIN_PASSWORD)
  if (problem) return say(false, problem)
  state.busy = true
  try {
    const raw = await C.dekFromPassword(s.model.header, old)
    if (!raw) return say(false, "The current master password is wrong")
    s.model.header.password = await C.passwordBlock(raw, password)
    s.model.header.at = Date.now()
    await saveLocal()
    await markDirty()
    return say(true, "The master password is changed; other devices go on without asking")
  } finally {
    state.busy = false
  }
}

export async function newRecovery(password) {
  state.busy = true
  try {
    const raw = await C.dekFromPassword(s.model.header, password)
    if (!raw) return say(false, "Wrong master password")
    const { block, code } = await C.recoveryBlock(raw)
    s.model.header.recovery = block
    s.model.header.at = Date.now()
    for (const [lid, lst] of s.model.liveLists()) {
      const key = s.model.currentKey(lid)
      if (lst.lock && key) await s.model.rewrapForRecovery(lst, key)
    }
    state.recovery = code
    await saveLocal()
    await markDirty()
    await refresh()
    return say(true, "A new recovery key")
  } finally {
    state.busy = false
  }
}

export function ackRecovery() {
  state.recovery = ""
}

// Forget the master password on this phone: it is asked next time.
export async function forget() {
  stopSyncing()
  await db.del("dek")
  await db.del("mackey")
  s.model = null
  s.dek = null
  s.mac = null
  s.token = ""
  state.lists = []
  state.remembered = false
  state.phase = "locked"
}

// Stop syncing and remove everything from this phone (GitHub keeps it).
export async function disconnect() {
  stopSyncing()
  await db.clear()
  s.model = null
  s.dek = null
  s.token = ""
  state.lists = []
  state.settings.repo = ""
  state.phase = "connect"
}

// ---------- changes ----------

async function changed(didChange) {
  if (didChange) {
    await saveLocal()
    await markDirty()
  }
  await refresh()
  return didChange
}

export async function op(change) {
  if (!s.model) return false
  return changed(await s.model.apply(change))
}

export async function unlockList(lid, password) {
  state.busy = true
  try { return changed(await s.model.unlockList(lid, password)) } finally { state.busy = false }
}
export async function unlockOld(lid, secret) {
  state.busy = true
  try { return changed(await s.model.unlockOld(lid, secret)) } finally { state.busy = false }
}
export async function recoverList(lid, code, password) {
  state.busy = true
  try { return changed(await s.model.recoverList(lid, code, password)) } finally { state.busy = false }
}
export async function setLock(lid, password) {
  state.busy = true
  try { return changed(await s.model.setLock(lid, password)) } finally { state.busy = false }
}
export async function removeLock(lid) {
  return changed(await s.model.removeLock(lid))
}
export async function changeListPassword(lid, password) {
  state.busy = true
  try { return changed(await s.model.changeListPassword(lid, password)) } finally { state.busy = false }
}

// Locked lists lock again: from the settings, and when the app is left.
export async function lockLists() {
  if (!s.model) return
  s.model.lockAll()
  await refresh()
}

// ---------- syncing ----------

function scheduleSync(delay) {
  clearTimeout(s.timer)
  s.timer = setTimeout(() => sync(), delay)
}

function startSyncing() {
  stopSyncing()
  if (!state.settings.repo || !s.token) return
  scheduleSync(0)
  s.every = setInterval(() => { if (document.visibilityState === "visible") sync() }, SYNC_EVERY)
}

function stopSyncing() {
  clearTimeout(s.timer)
  clearInterval(s.every)
  s.timer = s.every = null
}

// One round: fetch, merge, push when either side has something new.
export async function sync() {
  if (s.syncing || !s.model || !state.settings.repo || !s.token) return
  s.syncing = true
  state.sync.state = "syncing"
  const gh = new GitHub(state.settings.repo, state.settings.path, s.token)
  const gen = s.gen
  try {
    const result = await syncRound({ model: s.model, dek: s.dek, macKey: s.mac, gh, dirty: s.dirty, etag: s.etag, saveLocal })
    s.etag = result.etag
    // A change made while this round ran is still to go.
    const dirty = result.dirty || s.gen !== gen
    if (s.dirty !== dirty) {
      s.dirty = dirty
      await db.set("dirty", dirty)
    }
    if (result.changed) await refresh()
    state.sync = { state: "ok", last: Date.now(), error: "" }
  } catch (e) {
    if (e instanceof TypeError) {
      state.sync = { ...state.sync, state: "offline", error: "Offline; it syncs when the network is back" }
      scheduleSync(RETRY_OFFLINE)
    } else {
      state.sync = { ...state.sync, state: "error", error: String(e.message || e).slice(0, 300) }
    }
  } finally {
    s.syncing = false
    if (s.dirty && state.sync.state === "ok") scheduleSync(SYNC_AFTER_CHANGE)
  }
}

// Back online, or back in the app: sync. Leaving the app locks locked lists.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => sync())
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync()
    else lockLists()
  })
}
