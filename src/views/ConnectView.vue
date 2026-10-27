<script setup>
import Field from "../components/Field.vue"
import { ref } from "vue"
import { state, connect } from "../store.js"

const logo = import.meta.env.BASE_URL + "icons/icon-192.png"
const repo = ref("")
const token = ref("")
const password = ref("")
const help = ref(false)

async function go() {
  if (await connect({ repo: repo.value, token: token.value, password: password.value })) {
    token.value = ""
    password.value = ""
  }
}
</script>

<template>
  <div class="form-screen">
    <img class="logo" :src="logo" alt="" />
    <h1>To-Do Lists</h1>
    <p class="lead">Your lists from Omarchy, on this device. They stay encrypted; only your master password opens them.</p>
    <form class="card stack" @submit.prevent="go">
      <Field v-model="repo" label="GitHub repository" placeholder="owner/name"
             hint="The private repository your lists sync to." />
      <Field v-model="token" type="password" label="GitHub token"
             hint="A fine-grained token for that repository: Contents, read and write." />
      <Field v-model="password" type="password" label="Master password" autocomplete="current-password" />
      <button class="primary wide" type="submit" :disabled="state.busy">{{ state.busy ? "Connecting…" : "Connect" }}</button>
    </form>
    <button class="link" @click="help = !help">{{ help ? "Hide" : "Which token?" }}</button>
    <p v-if="help" class="help">
      github.com › Settings › Developer settings › Fine-grained tokens › Generate new token. Repository access: only the
      repository your lists sync to; Permissions: Contents, read and write. It is kept here, encrypted with your lists' key.
      An empty repository starts new lists with this master password.
    </p>
  </div>
</template>
