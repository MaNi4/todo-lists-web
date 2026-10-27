<script setup>
import Field from "../components/Field.vue"
// Every list in a row: a handle to drag it, its color, its name to rename
// it, its lock, its bin. One row at a time opens below itself for what needs
// more (a list password, a color, a confirmation).
import { ref, watch } from "vue"
import { state, op, setLock, removeLock, unlockList, changeListPassword, lockLists } from "../store.js"
import Icon from "../components/Icon.vue"

defineProps({ current: String })
const emit = defineEmits(["back", "select"])

const open = ref("")  // the list whose row is open
const mode = ref("")  // "lock", "unlock", "unlocked", "repass", "delete"
const pw = ref("")
const pw2 = ref("")
watch([open, mode], () => { pw.value = pw2.value = "" })

function toggle(id, m) {
  if (open.value === id && mode.value === m) close()
  else { open.value = id; mode.value = m }
}
const lockMode = l => (!l.locked ? "lock" : l.unlocked ? "unlocked" : "unlock")
function close() { open.value = ""; mode.value = "" }
const say = text => { state.notice = { id: Date.now(), ok: false, text } }

async function rename(l, e) {
  const name = e.target.value.trim()
  if (name && name !== l.name) await op({ op: "renameList", list: l.id, name })
  else e.target.value = l.name
}
async function doLock(l) {
  if (pw.value.length < 4) return say("Use at least 4 characters")
  if (pw.value !== pw2.value) return say("The passwords are not the same")
  if (await setLock(l.id, pw.value)) close()
}
async function doUnlock(l) {
  if (!pw.value) return
  await unlockList(l.id, pw.value)
  pw.value = ""
}
async function doRepass(l) {
  if (pw.value.length < 4) return say("Use at least 4 characters")
  if (pw.value !== pw2.value) return say("The passwords are not the same")
  if (await changeListPassword(l.id, pw.value)) close()
}
async function doRemoveLock(l) { await removeLock(l.id); close() }
async function doDelete(l) { await op({ op: "removeList", list: l.id }); close() }
// Unlocked from its row: the row closes.
watch(() => state.lists, lists => {
  const l = lists.find(x => x.id === open.value)
  if (l && mode.value === "unlock" && l.unlocked) close()
})

// ---------- dragging ----------
const dragId = ref("")
const offset = ref(0)
let startY = 0
let rowHeight = 60
function down(l, e) {
  dragId.value = l.id
  startY = e.clientY
  rowHeight = e.currentTarget.closest(".lrow").offsetHeight
  e.currentTarget.setPointerCapture(e.pointerId)
  if (navigator.vibrate) navigator.vibrate(10)
}
function moveTo(e) { if (dragId.value) offset.value = e.clientY - startY }
async function up() {
  if (!dragId.value) return
  const id = dragId.value
  const by = Math.round(offset.value / rowHeight)
  dragId.value = ""
  offset.value = 0
  if (by) await op({ op: "moveList", list: id, by })
}

const newName = ref("")
async function addList() {
  const name = newName.value.trim()
  if (!name) return
  if (await op({ op: "addList", name })) newName.value = ""
}
</script>

<template>
  <div class="page">
    <header class="bar">
      <button class="link back" @click="emit('back')"><Icon name="back" :size="18" /> Back</button>
    </header>
    <h1 class="big">Lists</h1>

    <TransitionGroup name="rows" tag="div" class="card group">
      <div v-for="l in state.lists" :key="l.id" class="lrow" :style="{ transform: dragId === l.id ? `translateY(${offset}px)` : '' }"
           :class="{ dragging: dragId === l.id }">
        <div class="line">
          <span class="grip" @pointerdown="down(l, $event)" @pointermove="moveTo" @pointerup="up" @pointercancel="up"><Icon name="grip" :size="15" /></span>
          <input class="name" :class="{ current: l.id === current }" :value="l.name" :aria-label="'Name of ' + l.name" maxlength="60" enterkeyhint="done"
                 @keydown.enter.prevent="$event.target.blur()" @blur="rename(l, $event)" />
          <span v-if="l.open && !(l.locked && !l.unlocked)" class="n">{{ l.open }}</span>
          <button class="icon" :class="{ on: l.locked }" :aria-label="l.locked ? 'Its lock' : 'Lock it'" @click="toggle(l.id, lockMode(l))">
            <Icon :name="l.locked && !l.unlocked ? 'lock' : 'unlock'" :size="18" />
          </button>
          <button class="icon" aria-label="Delete" @click="toggle(l.id, l.locked && !l.unlocked ? 'unlock' : 'delete')"><Icon name="trash" :size="18" /></button>
        </div>

        <div v-if="open === l.id" class="more stack">
          <template v-if="mode === 'lock'">
            <p class="dim small">A list password: this list's own, not the master password. Its to-dos are encrypted again with it and stay hidden until it is typed.</p>
            <form class="stack" @submit.prevent="doLock(l)">
              <Field v-model="pw" type="password" label="List password" hint="4 characters or more." />
              <Field v-model="pw2" type="password" label="List password again" />
              <button class="primary wide" type="submit" :disabled="state.busy">Lock</button>
            </form>
          </template>
          <form v-else-if="mode === 'unlock'" class="stack" @submit.prevent="doUnlock(l)">
            <Field v-model="pw" type="password" label="List password" />
            <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Unlock" }}</button>
          </form>
          <template v-else-if="mode === 'unlocked'">
            <p class="dim small">Unlocked until you leave the app, or lock the lists.</p>
            <div class="choices">
              <button @click="toggle(l.id, 'repass')"><Icon name="key" :size="17" /> Change list password</button>
              <button @click="doRemoveLock(l)"><Icon name="unlock" :size="17" /> Remove the lock</button>
              <button @click="lockLists(); close()"><Icon name="lock" :size="17" /> Lock now</button>
            </div>
          </template>
          <template v-else-if="mode === 'repass'">
            <p class="dim small">A new list password. Its to-dos stay as they are, on every device.</p>
            <form class="stack" @submit.prevent="doRepass(l)">
              <Field v-model="pw" type="password" label="New list password" hint="4 characters or more." />
              <Field v-model="pw2" type="password" label="New list password again" />
              <button class="primary wide" type="submit" :disabled="state.busy">Change</button>
            </form>
          </template>
          <template v-else-if="mode === 'delete'">
            <p class="small">Delete <strong>{{ l.name }}</strong>{{ l.items && l.items.length ? ` and its ${l.items.length} to-dos` : "" }}? It cannot be undone.</p>
            <div class="row">
              <button class="wide" @click="close">Cancel</button>
              <button class="danger solid wide" @click="doDelete(l)">Delete</button>
            </div>
          </template>
        </div>
      </div>
    </TransitionGroup>

    <form class="card new" @submit.prevent="addList">
      <span class="ring" />
      <input v-model="newName" aria-label="New list" placeholder="New list" maxlength="60" enterkeyhint="done" />
      <button class="link" type="submit" :disabled="!newName.trim()">Add</button>
    </form>
    <p class="faint tiny hint">Drag a list by its handle to move it; tap its name to rename it.</p>
  </div>
</template>

<style scoped>
.page { padding: calc(20px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom)); }
.bar { display: flex; align-items: center; min-height: 52px; padding: 0 6px; }
.back { gap: 2px; padding-left: 0; font-weight: 500; }
.big { margin: 6px 6px 18px; }
.group { overflow: hidden; padding: 4px 0; }
.lrow { position: relative; background: var(--card); }
.lrow + .lrow::before { content: ""; position: absolute; top: 0; left: 44px; right: 16px; height: 1px; background: var(--sep); }
.lrow.dragging { z-index: 5; box-shadow: var(--shadow); border-radius: 16px; }
.line { display: flex; align-items: center; gap: 2px; min-height: 56px; padding: 0 8px 0 4px; }
.grip { color: var(--faint); opacity: .6; padding: 14px 8px 14px 12px; touch-action: none; cursor: grab; display: flex; }
.name { flex: 1; min-width: 0; height: 42px; background: none; border-color: transparent; padding: 0 8px; }
.name:focus { background: var(--field); border-color: var(--text); box-shadow: none; }
.name.current { font-weight: 600; }
.n { color: var(--faint); font-size: 14px; padding: 0 6px; }
.icon { width: 40px; height: 40px; padding: 0; border-radius: 50%; background: none; color: var(--faint); }
.icon.on { color: var(--text); }
.more { padding: 2px 18px 18px 44px; }
.choices { display: flex; flex-direction: column; gap: 8px; }
.choices button { justify-content: flex-start; font-weight: 500; }
.rows-move { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.new { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 5px 10px 5px 18px; }
.new .ring { width: 20px; height: 20px; border-radius: 50%; border: 2px dashed var(--ring); flex: none; }
.new input { background: none; border: none; padding: 0 4px; }
.new input:focus { box-shadow: none; border: none; }
.new .link { color: var(--text); }
.hint { margin: 12px 10px; }
</style>
