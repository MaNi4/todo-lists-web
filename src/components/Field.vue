<script setup>
// A text field with its label above it (tied to it, so a tap on the label
// focuses the field and screen readers name it) and an optional hint below.
// A placeholder is only ever an example of what to type.
import { useId } from "vue"

defineProps({
  label: { type: String, required: true },
  hint: String,
  type: { type: String, default: "text" },
  autocomplete: { type: String, default: "off" },
  placeholder: String,
  autocapitalize: { type: String, default: "off" },
  inputmode: String,
  enterkeyhint: String,
})
const model = defineModel({ type: String, default: "" })
const id = useId()
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <input :id="id" v-model="model" :type="type" :autocomplete="autocomplete" :placeholder="placeholder"
           :autocapitalize="autocapitalize" :inputmode="inputmode" :enterkeyhint="enterkeyhint"
           autocorrect="off" spellcheck="false" :aria-describedby="hint ? id + '-hint' : undefined" />
    <p v-if="hint" :id="id + '-hint'" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; text-align: left; }
label { font-size: 14px; font-weight: 600; color: var(--text); padding: 0 2px; }
.field-hint { font-size: 13px; color: var(--dim); padding: 0 2px; }
</style>
