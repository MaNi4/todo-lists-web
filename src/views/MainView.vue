<script setup>
import Field from "../components/Field.vue"
import { ref, computed, watch, nextTick, onUnmounted } from "vue"
import { state, op, sync, unlockList, unlockOld, recoverList } from "../store.js"
import { randomHex } from "../lib/crypto.js"
import Icon from "../components/Icon.vue"
import ItemRow from "../components/ItemRow.vue"
import ListsPage from "./ListsPage.vue"
import SettingsPage from "./SettingsPage.vue"

const page = ref("list") // "list", "lists", "settings"
// Development only: #demo-lists, #demo-settings, #demo-locked, #demo-add.
const demoView = import.meta.env.DEV ? location.hash.replace("#demo-", "") : ""
if (demoView === "lists" || demoView === "settings") page.value = demoView

const showDone = ref(true)
const openRow = ref("") // the to-do swiped open

// The list in view, remembered on this device (only its id).
const listId = ref(localStorage.getItem("todo-lists:list") || "")
if (demoView === "locked") watch(() => state.lists, l => { const x = l.find(y => y.locked); if (x) listId.value = x.id }, { immediate: true })
else if (import.meta.env.DEV && location.hash.startsWith("#demo")) watch(() => state.lists, l => { if (l[0]) listId.value = l[0].id }, { immediate: true })
const current = computed(() => state.lists.find(l => l.id === listId.value) || state.lists[0] || null)
watch(current, l => { if (l) localStorage.setItem("todo-lists:list", l.id) })
function select(id) {
  flushTicks()
  flushRemovals()
  listId.value = id
  openRow.value = ""
  adding.value = false
}

const hidden = computed(() => !!current.value && current.value.locked && !current.value.unlocked)
const items = computed(() => (current.value && current.value.items) || [])
const openItems = computed(() => items.value.filter(x => !x.done && !removing.value[x.id]))
const doneItems = computed(() => items.value.filter(x => x.done && !removing.value[x.id]))

// ---------- deleting, with Undo ----------
// Deleted to-dos are hidden at once and deleted for good a few seconds later,
// unless Undo brings them back (a deletion that synced cannot be undone).
const removing = ref({}) // to-do id -> its list id
let removeTimer = null
function removeLater(list, ids, text) {
  removing.value = { ...removing.value, ...Object.fromEntries(ids.map(id => [id, list])) }
  openRow.value = ""
  clearTimeout(removeTimer)
  removeTimer = setTimeout(flushRemovals, 5200)
  state.notice = { id: Date.now(), ok: true, text, undo: () => {
    const r = { ...removing.value }
    for (const id of ids) delete r[id]
    removing.value = r
  } }
}
async function flushRemovals() {
  clearTimeout(removeTimer)
  const r = removing.value
  if (!Object.keys(r).length) return
  removing.value = {}
  if (state.notice && state.notice.undo) state.notice = null
  for (const [id, list] of Object.entries(r)) await op({ op: "remove", list, item: id })
}
const onHidden = () => { if (document.hidden) { flushTicks(); flushRemovals() } }
document.addEventListener("visibilitychange", onHidden)
onUnmounted(() => { document.removeEventListener("visibilitychange", onHidden); flushRemovals() })
function removeItem(it) { removeLater(current.value.id, [it.id], "Deleted") }

// ---------- moving a to-do to another list ----------
const moving = ref(null) // the to-do whose list is being chosen
// The click that follows the finger lifting off Move lands on the backdrop
// that just appeared: it does not close it.
let movingSince = 0
watch(moving, m => { if (m) movingSince = Date.now() })
function closeMoving() { if (Date.now() - movingSince > 500) moving.value = null }
const otherLists = computed(() => state.lists.filter(l => current.value && l.id !== current.value.id))
// Undo moves it back, to the place it had: the new record is named here.
async function moveTo(l) {
  const it = moving.value
  moving.value = null
  if (!it || !l || (l.locked && !l.unlocked)) return
  const from = current.value.id
  const at = it.done ? undefined : openItems.value.findIndex(x => x.id === it.id)
  const as = randomHex(8)
  if (!(await op({ op: "moveTo", list: from, item: it.id, to: l.id, as }))) return
  state.notice = { id: Date.now(), ok: true, text: "Moved to " + l.name, undo: async () => {
    if (!(await op({ op: "moveTo", list: l.id, item: as, to: from, as: randomHex(8), at })))
      state.notice = { id: Date.now(), ok: false, text: "It cannot go back: " + l.name + " is locked again" }
  } }
}

// ---------- ticking ----------
// A ticked to-do stays where it is for a moment, so a slip can be taken
// back; then it goes.
const pending = ref({})
let tickTimer = null
const isTicked = it => (pending.value[it.id] !== undefined ? pending.value[it.id].done : it.done)
function tick(it) {
  const p = { ...pending.value }
  if (p[it.id] !== undefined) delete p[it.id]
  else p[it.id] = { list: current.value.id, done: !it.done }
  pending.value = p
  clearTimeout(tickTimer)
  tickTimer = setTimeout(flushTicks, 1000)
}
async function flushTicks() {
  clearTimeout(tickTimer)
  const p = pending.value
  pending.value = {}
  for (const [id, v] of Object.entries(p)) await op({ op: "done", list: v.list, item: id, done: v.done })
}

// ---------- adding: the + opens a new row at the end of the card ----------
const adding = ref(import.meta.env.DEV && location.hash === "#demo-add")
const newText = ref("")
const addInput = ref(null)
async function startAdding() {
  adding.value = true
  await nextTick()
  addInput.value && addInput.value.focus()
}
async function add() {
  const text = newText.value.trim()
  if (!text || !current.value) return
  newText.value = ""
  await op({ op: "add", list: current.value.id, text })
  await nextTick()
  addInput.value && addInput.value.focus()
}
function stopAdding() {
  if (!newText.value.trim()) adding.value = false
}

function clearDone() {
  const ids = doneItems.value.map(x => x.id)
  removeLater(current.value.id, ids, ids.length === 1 ? "Cleared 1 to-do" : `Cleared ${ids.length} to-dos`)
}

// ---------- a locked list ----------
const listPw = ref("")
const recoveringList = ref(false)
const recCode = ref("")
const recPw = ref("")
const recPw2 = ref("")
watch(hidden, h => { if (!h) { recoveringList.value = false; listPw.value = "" } })
async function openList() {
  if (!listPw.value) return
  await unlockList(current.value.id, listPw.value)
  listPw.value = ""
}
async function recoverThisList() {
  if (recPw.value !== recPw2.value) { state.notice = { id: Date.now(), ok: false, text: "The passwords are not the same" }; return }
  await recoverList(current.value.id, recCode.value, recPw.value)
  recPw.value = recPw2.value = ""
}

// ---------- sealed with an older list password ----------
const staleSecret = ref("")
const armedStale = ref(false)
async function openStale() {
  if (!staleSecret.value) return
  await unlockOld(current.value.id, staleSecret.value)
  staleSecret.value = ""
}
async function dropStale() {
  if (!armedStale.value) { armedStale.value = true; return }
  armedStale.value = false
  await op({ op: "removeStale", list: current.value.id })
}

// ---------- sync, quietly under the date ----------
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"
}
const syncText = computed(() => {
  const st = state.sync
  if (!state.settings.repo) return ""
  if (st.state === "syncing") return "Syncing…"
  if (st.state === "offline") return "Offline"
  if (st.state === "error") return "Not synced"
  return st.last ? "Synced " + ago(st.last) : ""
})
const syncIcon = computed(() => ["offline", "error"].includes(state.sync.state) ? "cloud-off" : state.sync.state === "syncing" ? "cloud" : "cloud-ok")
function syncNow() {
  if (state.sync.state === "error" || state.sync.state === "offline") state.notice = { id: Date.now(), ok: false, text: state.sync.error }
  sync()
}
</script>

<template>
  <ListsPage v-if="page === 'lists'" :current="current && current.id" @back="page = 'list'" @select="id => { select(id); page = 'list' }" />
  <SettingsPage v-else-if="page === 'settings'" @back="page = 'list'" />
  <div v-else class="main">
    <header class="head">
      <button v-if="syncText" class="sync link" :class="{ bad: state.sync.state === 'error' }"
              :aria-label="syncText + '. Sync now'" @click="syncNow">
        <Icon :name="syncIcon" :size="16" /> {{ syncText }}
      </button>
      <span v-else />
      <div class="actions">
        <button class="round" aria-label="Lists" @click="page = 'lists'"><Icon name="lists" :size="18" /></button>
        <button class="round" aria-label="Settings" @click="page = 'settings'"><Icon name="settings" :size="18" /></button>
      </div>
    </header>

    <h1 class="title">{{ current ? current.name : "To-Do Lists" }}</h1>

    <nav class="tabs">
      <button v-for="l in state.lists" :key="l.id" class="tab" :class="{ on: current && l.id === current.id }" @click="select(l.id)">
        <Icon v-if="l.locked" :name="l.unlocked ? 'unlock' : 'lock'" :size="14" />
        {{ l.name }}<b v-if="l.open && !(l.locked && !l.unlocked)">{{ l.open }}</b>
      </button>
    </nav>

    <!-- a locked list -->
    <section v-if="hidden" class="card locked">
      <div class="lock-badge"><Icon name="lock" :size="24" /></div>
      <p class="locked-title">This list is locked</p>
      <p class="dim small">{{ current.open ? current.open + " to do · " : "" }}its list password opens it</p>
      <template v-if="!recoveringList">
        <form class="stack unlock" @submit.prevent="openList">
          <Field v-model="listPw" type="password" label="List password" />
          <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Unlock" }}</button>
        </form>
        <button v-if="current.recoverable" class="link" @click="recoveringList = true">Forgot it? Use the recovery key</button>
        <p v-if="current.oldLock" class="faint tiny">This lock is from an older version: unlock it once on the computer.</p>
      </template>
      <form v-else class="stack recover" @submit.prevent="recoverThisList">
        <p class="dim small">The recovery key opens this list. Choose a new list password, or leave both empty to take the lock off.</p>
        <Field v-model="recCode" label="Recovery key" placeholder="XXXX-XXXX-XXXX-…" autocapitalize="characters" />
        <Field v-model="recPw" type="password" label="New list password" hint="Leave it empty to take the lock off." />
        <Field v-model="recPw2" type="password" label="New list password again" />
        <div class="row">
          <button type="button" class="wide" @click="recoveringList = false">Back</button>
          <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Open" }}</button>
        </div>
      </form>
    </section>

    <template v-else-if="current">
      <!-- sealed with an older list password -->
      <section v-if="current.stale" class="card notice stack">
        <p class="small"><strong>{{ current.stale }} {{ current.stale === 1 ? "to-do is" : "to-dos are" }} sealed</strong>
          <span class="dim"> with an older list password, from before it changed. That password, or the recovery key, opens them.</span></p>
        <form class="stack" @submit.prevent="openStale">
          <Field v-model="staleSecret" type="password" label="Older list password, or recovery key" />
          <button class="primary wide" type="submit">Open</button>
        </form>
        <button class="danger wide" @click="dropStale">{{ armedStale ? "Delete them for good?" : "Delete them" }}</button>
      </section>

      <section v-if="openItems.length || adding" class="card list">
        <TransitionGroup name="items">
          <ItemRow v-for="it in openItems" :key="it.id" :item="it" :ticked="isTicked(it)" :open-id="openRow"
                   :can-move-to="otherLists.length > 0" @move-to="moving = it"
                   @open="id => (openRow = id)" @toggle="tick(it)"
                   @edit="t => op({ op: 'edit', list: current.id, item: it.id, text: t })"
                   @remove="removeItem(it)"
                   @move="by => op({ op: 'move', list: current.id, item: it.id, by })" />
        </TransitionGroup>
        <form v-if="adding" class="new-row" :class="{ first: !openItems.length }" @submit.prevent="add">
          <span class="ring" />
          <input ref="addInput" v-model="newText" aria-label="New to-do" placeholder="New to-do" enterkeyhint="done" @blur="stopAdding" />
        </form>
      </section>
      <div v-else class="empty">
        <p class="dim">Nothing to do{{ doneItems.length ? " here any more" : " yet" }}.</p>
        <button class="link" @click="startAdding">Add a to-do</button>
      </div>

      <template v-if="doneItems.length">
        <div class="done-head">
          <button class="link" @click="showDone = !showDone">Completed · {{ doneItems.length }}</button>
          <button class="link" @click="clearDone">Clear</button>
        </div>
        <section v-if="showDone" class="card list">
          <TransitionGroup name="items">
            <ItemRow v-for="it in doneItems" :key="it.id" :item="it" :ticked="isTicked(it)" :open-id="openRow"
                     :can-move-to="otherLists.length > 0" @move-to="moving = it"
                     @open="id => (openRow = id)" @toggle="tick(it)"
                     @remove="removeItem(it)" />
          </TransitionGroup>
        </section>
      </template>
    </template>

    <button v-if="current && !hidden && !adding" class="fab" aria-label="New to-do" @click="startAdding">
      <Icon name="plus" :size="26" />
    </button>

    <!-- where a to-do moves: the other lists; a locked one must be unlocked first -->
    <transition name="sheet">
      <div v-if="moving" class="sheet-back" @click.self="closeMoving">
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="move-title">
          <p id="move-title" class="sheet-title">Move “{{ moving.text }}” to</p>
          <div class="card group">
            <button v-for="l in otherLists" :key="l.id" class="sheet-row" :disabled="l.locked && !l.unlocked" @click="moveTo(l)">
              <Icon v-if="l.locked" :name="l.unlocked ? 'unlock' : 'lock'" :size="16" />
              <span class="sheet-name">{{ l.name }}</span>
              <span v-if="l.locked && !l.unlocked" class="tiny faint">unlock it first</span>
            </button>
          </div>
          <button class="wide" @click="moving = null">Cancel</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.main { min-height: 100dvh; padding: calc(20px + env(safe-area-inset-top)) 16px calc(120px + env(safe-area-inset-bottom)); }
.head { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 6px; }
.sync { padding: 0; gap: 6px; font-size: 13px; font-weight: 500; color: var(--dim); }
.sync.bad { color: var(--danger); }
.actions { display: flex; gap: 10px; }
.title { margin: 6px 6px 14px; overflow-wrap: anywhere; }

.tabs {
  display: flex;
  gap: 22px;
  margin: 0 6px 18px;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  flex: none;
  height: auto;
  padding: 0 0 11px;
  border-radius: 0;
  background: none;
  color: var(--dim);
  font-size: 15px;
  font-weight: 500;
  gap: 5px;
  position: relative;
  white-space: nowrap;
}
.tab:active { transform: none; }
.tab b { font-weight: 500; color: var(--faint); font-size: 13px; margin-left: 1px; }
.tab.on { color: var(--text); font-weight: 600; }
.tab.on::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px; background: var(--text); }

.list { overflow: hidden; }
.items-move, .items-enter-active, .items-leave-active { transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .25s; }
.items-enter-from { opacity: 0; }
.items-leave-to { opacity: 0; transform: translateX(24px); }
.items-leave-active { position: absolute; width: 100%; }

.new-row { display: flex; align-items: center; gap: 12px; padding: 5px 12px 5px 17px; position: relative; }
.new-row:not(.first)::before { content: ""; position: absolute; top: 0; left: 54px; right: 16px; height: 1px; background: var(--sep); }
.new-row .ring { width: 22px; height: 22px; border-radius: 50%; border: 2px dashed var(--ring); flex: none; }
.new-row input { height: 44px; background: none; border: none; padding: 0 4px; }
.new-row input:focus { box-shadow: none; border: none; }

.empty { text-align: center; padding: 40px 0 20px; }
.sheet-back { position: fixed; inset: 0; z-index: 70; background: rgba(0, 0, 0, .35); display: flex; align-items: flex-end; }
.sheet { width: 100%; max-width: 640px; margin: 0 auto; padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
         background: var(--bg); border-radius: 24px 24px 0 0; display: flex; flex-direction: column; gap: 12px; }
.sheet-title { font-weight: 600; margin: 0 6px; overflow-wrap: anywhere; }
.sheet .group { overflow: hidden; max-height: 55dvh; overflow-y: auto; }
.sheet-row { width: 100%; height: 54px; justify-content: flex-start; gap: 10px; padding: 0 18px; border-radius: 0;
             background: none; font-weight: 500; }
.sheet-row + .sheet-row { box-shadow: inset 0 1px 0 var(--sep); }
.sheet-row:disabled { opacity: .45; }
.sheet-name { flex: 1; text-align: left; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .2s; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .25s cubic-bezier(.2, .8, .2, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(40px); }
.done-head { display: flex; justify-content: space-between; align-items: center; margin: 22px 8px 8px; }
.done-head .link { font-size: 13px; padding: 4px 2px; }

.locked .unlock, .locked .recover { text-align: left; margin-top: 8px; }
.locked { padding: 26px 18px 20px; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.lock-badge { width: 54px; height: 54px; margin: 0 auto 4px; border-radius: 50%; background: var(--soft); color: var(--dim);
              display: flex; align-items: center; justify-content: center; }
.locked-title { font-size: 18px; font-weight: 600; }
.locked .row { margin-top: 8px; }
.locked .recover { text-align: left; margin-top: 8px; }
.notice { padding: 16px; margin-bottom: 14px; }

.fab {
  position: fixed;
  right: max(22px, calc(50vw - 298px));
  bottom: calc(30px + env(safe-area-inset-bottom));
  width: 60px;
  height: 60px;
  padding: 0;
  border-radius: 20px;
  background: var(--strong);
  color: var(--on-strong);
  box-shadow: 0 10px 24px rgba(0, 0, 0, .2);
  z-index: 30;
}
</style>
