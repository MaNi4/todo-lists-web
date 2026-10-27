<script setup>
import Field from "../components/Field.vue"
import { ref } from "vue"
import { state, unlock, recover } from "../store.js"

const logo = import.meta.env.BASE_URL + "icons/icon-192.png"
const password = ref("")
const recovering = ref(false)
const code = ref("")
const newPw = ref("")
const newPw2 = ref("")

async function open() {
  if (!password.value) return
  await unlock(password.value)
  password.value = ""
}

async function useRecovery() {
  if (newPw.value !== newPw2.value) { state.notice = { id: Date.now(), ok: false, text: "The passwords are not the same" }; return }
  if (await recover(code.value, newPw.value)) code.value = ""
  newPw.value = newPw2.value = ""
}
</script>

<template>
  <div class="form-screen">
    <img class="logo" :src="logo" alt="" />
    <template v-if="!recovering">
      <h1>Welcome back</h1>
      <p class="lead">Your lists are encrypted. Type the master password to open them.</p>
      <form class="card stack" @submit.prevent="open">
        <Field v-model="password" type="password" label="Master password" autocomplete="current-password" />
        <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "Opening…" : "Open" }}</button>
      </form>
      <button class="link" @click="recovering = true">Forgot the master password?</button>
    </template>
    <template v-else>
      <h1>Recovery</h1>
      <p class="lead">Type your recovery key (shown when you set your lists up) and choose a new master password.</p>
      <form class="card stack" @submit.prevent="useRecovery">
        <Field v-model="code" label="Recovery key" placeholder="XXXX-XXXX-XXXX-…" autocapitalize="characters" />
        <Field v-model="newPw" type="password" label="New master password" autocomplete="new-password"
               hint="12 characters or more." />
        <Field v-model="newPw2" type="password" label="New master password again" autocomplete="new-password" />
        <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "…" : "Set the new master password" }}</button>
      </form>
      <button class="link" @click="recovering = false">Back</button>
    </template>
  </div>
</template>
