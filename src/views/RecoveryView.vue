<script setup>
import { state, ackRecovery } from "../store.js"
import Icon from "../components/Icon.vue"

async function copy() {
  try {
    await navigator.clipboard.writeText(state.recovery)
    state.notice = { id: Date.now(), ok: true, text: "Copied; the clipboard is cleared in a minute" }
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 60000)
  } catch {
    state.notice = { id: Date.now(), ok: false, text: "Couldn't copy; write it down instead" }
  }
}
</script>

<template>
  <div class="form-screen">
    <div class="badge"><Icon name="key" :size="30" /></div>
    <h1>Your recovery key</h1>
    <p class="lead">
      If you forget the master password, or a list password, this key opens your lists and lets you set a new one.
      It is shown only now: keep it in your password manager, or on paper.
    </p>
    <div class="code card">{{ state.recovery }}</div>
    <div class="row actions">
      <button class="wide" @click="copy"><Icon name="copy" :size="18" /> Copy</button>
      <button class="primary wide" @click="ackRecovery">I saved it</button>
    </div>
  </div>
</template>

<style scoped>
.badge { width: 64px; height: 64px; border-radius: 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center;
         background: var(--card); color: var(--text); box-shadow: var(--shadow); margin-left: 6px; }
.code {
  padding: 20px 16px;
  font: 600 19px/1.7 ui-monospace, "SF Mono", Menlo, "Roboto Mono", monospace;
  letter-spacing: .05em;
  text-align: center;
  word-break: break-all;
  user-select: all;
  -webkit-user-select: all;
}
.actions { margin-top: 16px; }
</style>
