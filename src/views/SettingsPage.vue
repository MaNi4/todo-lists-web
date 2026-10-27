<script setup>
import Field from "../components/Field.vue"
import { ref } from "vue"
import { state, sync, changePassword, newRecovery, forget, disconnect, lockLists } from "../store.js"
import Icon from "../components/Icon.vue"
import { markdown } from "../lib/model.js"

const emit = defineEmits(["back"])
const say = (ok, text) => { state.notice = { id: Date.now(), ok, text } }

const open = ref("") // "password", "recovery"
const toggle = what => { open.value = open.value === what ? "" : what }

const oldPw = ref("")
const newPw = ref("")
const newPw2 = ref("")
async function change() {
  if (newPw.value !== newPw2.value) return say(false, "The passwords are not the same")
  if (await changePassword(oldPw.value, newPw.value)) { oldPw.value = newPw.value = newPw2.value = ""; open.value = "" }
}

const recPw = ref("")
async function makeRecovery() {
  if (!recPw.value) return say(false, "Type the master password")
  if (await newRecovery(recPw.value)) open.value = ""
  recPw.value = ""
}

// The lists as a Markdown file, not encrypted: shared (iPhone, Android:
// save to Files, send it) or downloaded.
async function exportLists() {
  const day = new Date().toISOString().slice(0, 10)
  const file = new File([markdown(state.lists, day)], `To-Do Lists ${day}.md`, { type: "text/markdown" })
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "To-Do Lists" })
      return
    }
  } catch (e) {
    if (e && e.name === "AbortError") return
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

const armedForget = ref(false)
const armedDisconnect = ref(false)

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"
}
const syncLine = () => state.sync.state === "error" || state.sync.state === "offline" ? state.sync.error
  : state.sync.state === "syncing" ? "Syncing…" : state.sync.last ? "Synced " + ago(state.sync.last) : "Not synced yet"
</script>

<template>
  <div class="page">
    <header class="bar">
      <button class="link back" @click="emit('back')"><Icon name="back" :size="18" /> Back</button>
    </header>
    <h1 class="big">Settings</h1>

    <p class="section-title">Sync</p>
    <div class="card group">
      <div class="srow">
        <span class="sicon"><Icon name="cloud" :size="18" /></span>
        <div class="stext">
          <div>{{ state.settings.repo || "Not connected" }}</div>
          <div class="tiny" :class="state.sync.state === 'error' ? 'bad' : 'faint'">{{ syncLine() }}</div>
        </div>
        <button class="link" @click="sync">Sync now</button>
      </div>
    </div>

    <p class="section-title">Security</p>
    <div class="card group">
      <button class="srow tap" @click="toggle('password')">
        <span class="sicon"><Icon name="key" :size="18" /></span>
        <span class="stext">Master password</span>
        <span class="chev" :class="{ open: open === 'password' }"><Icon name="right" :size="16" /></span>
      </button>
      <form v-if="open === 'password'" class="more stack" @submit.prevent="change">
        <p class="dim small">Your other devices go on without asking; a new one asks for the new master password.</p>
        <Field v-model="oldPw" type="password" label="Current master password" autocomplete="current-password" />
        <Field v-model="newPw" type="password" label="New master password" autocomplete="new-password" hint="12 characters or more." />
        <Field v-model="newPw2" type="password" label="New master password again" autocomplete="new-password" />
        <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Change the master password" }}</button>
      </form>

      <button class="srow tap" @click="toggle('recovery')">
        <span class="sicon"><Icon name="lock" :size="18" /></span>
        <span class="stext">Recovery key</span>
        <span class="chev" :class="{ open: open === 'recovery' }"><Icon name="right" :size="16" /></span>
      </button>
      <form v-if="open === 'recovery'" class="more stack" @submit.prevent="makeRecovery">
        <p class="dim small">Lost it, or never saved it? Make a new one; the old one stops working. Locked lists take it on when they are next unlocked.</p>
        <Field v-model="recPw" type="password" label="Master password" autocomplete="current-password" hint="To confirm it is you." />
        <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Make a new recovery key" }}</button>
      </form>
    </div>

    <p class="section-title">Your lists</p>
    <div class="card group">
      <button class="srow tap" @click="exportLists">
        <span class="sicon"><Icon name="export" :size="18" /></span>
        <div class="stext">
          <div>Export as Markdown</div>
          <div class="tiny faint">A plain text file, not encrypted. Locked lists only while unlocked.</div>
        </div>
      </button>
    </div>

    <p class="section-title">This device</p>
    <div class="card group">
      <button class="srow tap" @click="lockLists(); say(true, 'Locked lists are locked again')">
        <span class="sicon"><Icon name="lock" :size="18" /></span>
        <span class="stext">Lock the unlocked lists</span>
      </button>
      <button class="srow tap" @click="armedForget ? forget() : (armedForget = true)">
        <span class="sicon"><Icon name="key" :size="18" /></span>
        <span class="stext" :class="{ bad: armedForget }">{{ armedForget ? "Tap again: forget it and lock" : "Forget the master password here" }}</span>
      </button>
      <button class="srow tap" @click="armedDisconnect ? disconnect() : (armedDisconnect = true)">
        <span class="sicon"><Icon name="close" :size="18" /></span>
        <span class="stext" :class="{ bad: armedDisconnect }">{{ armedDisconnect ? "Tap again: remove everything from this device" : "Disconnect this device" }}</span>
      </button>
    </div>
    <p class="faint tiny note">The master password is kept here as the key it opens, which cannot be read back out. Locked lists lock again when you leave the app. Disconnecting removes the lists, the token and the key from this device; GitHub and your other devices keep them.</p>

    <p class="faint tiny about">To-Do Lists · for the Omarchy plugin mani4.todo-lists · end-to-end encrypted</p>
  </div>
</template>

<style scoped>
.page { padding: calc(20px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom)); }
.bar { display: flex; align-items: center; min-height: 52px; padding: 0 6px; }
.back { gap: 2px; padding-left: 0; font-weight: 500; }
.big { margin: 6px 6px 4px; }
.group { overflow: hidden; padding: 4px 0; }
.srow {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 56px;
  height: auto;
  padding: 8px 18px;
  background: none;
  border-radius: 0;
  font-weight: 500;
  text-align: left;
  position: relative;
}
.srow + .srow::before, .more + .srow::before { content: ""; position: absolute; top: 0; left: 52px; right: 16px; height: 1px; background: var(--sep); }
.srow.tap:active { transform: none; background: var(--soft); }
.sicon { width: 22px; display: flex; justify-content: center; color: var(--dim); flex: none; }
.stext { flex: 1; min-width: 0; }
.srow .link { color: var(--text); }
.chev { color: var(--faint); display: flex; transition: transform .2s; }
.chev.open { transform: rotate(90deg); }
.more { padding: 0 18px 18px 54px; }
.note { margin: 10px 10px; }
.about { text-align: center; margin: 30px 0 10px; }
</style>
