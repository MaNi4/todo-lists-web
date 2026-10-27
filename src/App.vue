<script setup>
import { onMounted, watch, ref } from "vue"
import { state, init } from "./store.js"
import ConnectView from "./views/ConnectView.vue"
import LockedView from "./views/LockedView.vue"
import RecoveryView from "./views/RecoveryView.vue"
import MainView from "./views/MainView.vue"

const logo = import.meta.env.BASE_URL + "icons/icon-192.png"
onMounted(init)

// A notice (wrong password, connected, ...) shows for a while at the bottom.
const shown = ref(null)
let timer = null
watch(() => state.notice, n => {
  if (!n) return
  shown.value = n
  clearTimeout(timer)
  timer = setTimeout(() => { shown.value = null }, n.undo ? 5000 : n.ok ? 3000 : 6000)
})
function undo() {
  const n = shown.value
  shown.value = null
  if (n && n.undo) n.undo()
}
</script>

<template>
  <div class="app">
    <div v-if="state.phase === 'loading'" class="splash"><img :src="logo" alt="" /></div>
    <div v-else-if="state.phase === 'error'" class="splash"><p class="bad">{{ state.error }}</p></div>
    <ConnectView v-else-if="state.phase === 'connect'" />
    <LockedView v-else-if="state.phase === 'locked'" />
    <RecoveryView v-else-if="state.recovery" />
    <MainView v-else />

    <transition name="toast">
      <div v-if="shown" class="toast" :class="{ bad: !shown.ok, 'has-undo': !!shown.undo }" :role="shown.ok ? 'status' : 'alert'"
           @click="shown.undo || (shown = null)">
        <span>{{ shown.text }}</span>
        <button v-if="shown.undo" class="undo" @click.stop="undo">Undo</button>
      </div>
    </transition>
  </div>
</template>

<style>
/* Soft cards on a warm ground; one accent, for what is done. */
:root {
  --bg: #f2f1ee;
  --card: #ffffff;
  --text: #1d1d1f;
  --dim: #67635b;          /* text: 5.4:1 on the ground */
  --faint: #8d897f;        /* counts and quiet details */
  --field-line: #8f8a80;   /* a field's edge: 3:1 */
  --line: #e4e1da;
  --sep: #f0eee9;
  --ring: #d6d2c8;
  --field: #ffffff;        /* a text field */
  --soft: #f3f1ec;         /* plain buttons, badges */
  --strong: #1d1d1f;      /* the main button */
  --on-strong: #ffffff;
  --accent: #f4a261;      /* done */
  --on-strong-accent: #f4a261;  /* Undo, on a notice */
  --danger: #e5484d;
  --edit: #77736b;         /* the Edit action: white on it, 4.6:1 */
  --move: #4d4a44;         /* the Move action */
  --shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 12px 30px rgba(60, 50, 30, .06);
  --radius: 24px;
  --radius-s: 14px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --card: #1c1c1e;
    --text: #f2f2f2;
    --dim: #a8a8ad;
    --faint: #7c7c82;
    --field-line: #6f6f75;
    --line: #2a2a2c;
    --sep: #262628;
    --ring: #48484a;
    --field: #1c1c1e;
    --soft: #2c2c2e;
    --strong: #f2f2f2;
    --on-strong: #121212;
    --on-strong-accent: #a8501a;
    --edit: #636366;
    --move: #48484a;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 12px 30px rgba(0, 0, 0, .25);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
body {
  font: 400 16px/1.45 system-ui, -apple-system, "SF Pro Text", Roboto, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  overscroll-behavior-y: none;
}
.app { max-width: 640px; margin: 0 auto; min-height: 100dvh; }
/* The status bar (clock, battery) sits over the page: an opaque strip behind
   it, so nothing scrolls under it and gets blurred there. */
body::before {
  content: "";
  position: fixed;
  top: 0; left: 0; right: 0;
  height: env(safe-area-inset-top);
  background: var(--bg);
  z-index: 50;
}
h1 { font-size: 34px; line-height: 1.1; font-weight: 700; letter-spacing: -.025em; margin: 0; }
p { margin: 0; }
.dim { color: var(--dim); }
.faint { color: var(--faint); }
.bad { color: var(--danger); }
.small { font-size: 14px; }
.tiny { font-size: 13px; }

/* ---------- controls ---------- */
input {
  width: 100%;
  height: 50px;
  padding: 0 14px;
  border: 1px solid var(--field-line);
  border-radius: var(--radius-s);
  background: var(--field);
  color: var(--text);
  font: inherit;
  font-size: 16px; /* 16px, or iOS zooms in */
  outline: none;
  transition: box-shadow .15s;
}
input:focus { border-color: var(--text); box-shadow: 0 0 0 1px var(--text); }
input::placeholder { color: var(--dim); opacity: .8; }

button {
  font: inherit;
  font-weight: 600;
  color: var(--text);
  background: var(--soft);
  border: none;
  border-radius: var(--radius-s);
  height: 50px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform .1s, opacity .15s;
}
button:active { transform: scale(.97); }
button:disabled { opacity: .4; }
button.primary { background: var(--strong); color: var(--on-strong); }
button.danger { color: var(--danger); }
button.danger.solid { background: var(--danger); color: #fff; }
button.round {
  width: 38px; height: 38px; padding: 0; border-radius: 50%;
  background: var(--card); color: var(--dim);
  box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0, 0, 0, .06);
}
button.link { background: none; height: auto; padding: 8px 4px; color: var(--dim); font-weight: 600; }
.wide { width: 100%; }

/* ---------- layout ---------- */
.stack > * + * { margin-top: 12px; }
.row { display: flex; gap: 10px; align-items: center; }
.row > input { flex: 1; min-width: 0; }
.card { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); }
.section-title { font-size: 13px; font-weight: 600; color: var(--dim); margin: 24px 10px 10px; }

/* Screens with one form (connect, locked, recovery). */
.form-screen {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: calc(24px + env(safe-area-inset-top)) 18px calc(24px + env(safe-area-inset-bottom));
}
.form-screen .logo { width: 60px; height: 60px; border-radius: 16px; box-shadow: var(--shadow); margin: 0 6px 22px; }
.form-screen h1 { margin: 0 6px 8px; }
.form-screen .lead { color: var(--dim); margin: 0 6px 22px; }
.form-screen .card { padding: 16px; }
.form-screen .help { color: var(--dim); font-size: 13px; margin: 16px 8px 0; }
.form-screen > .link { align-self: center; margin-top: 10px; }

.splash { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; }
.splash img { width: 68px; height: 68px; border-radius: 18px; animation: breathe 1.4s ease-in-out infinite; }
@keyframes breathe { 50% { transform: scale(.94); opacity: .6; } }

/* ---------- toast ---------- */
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(110px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: min(88vw, 520px);
  padding: 12px 18px;
  border-radius: 16px;
  background: var(--strong);
  color: var(--on-strong);
  box-shadow: var(--shadow);
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  z-index: 60;
}
.toast.bad { background: var(--danger); color: #fff; }
.toast.has-undo { display: flex; align-items: center; gap: 14px; padding: 6px 6px 6px 18px; }
.toast .undo { height: 36px; padding: 0 14px; border-radius: 11px; background: none; color: var(--on-strong-accent); font-size: 14px; }
.toast.has-undo span { white-space: nowrap; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
</style>
