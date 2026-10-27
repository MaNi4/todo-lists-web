<script setup>
// A to-do in its card. A tap ticks it. Swiped left, the row slides aside for
// Edit and Delete, full height; swiped all the way, it is deleted. Its handle
// drags it elsewhere.
import { ref, computed, watch, nextTick } from "vue"
import Icon from "./Icon.vue"

const props = defineProps({ item: Object, ticked: Boolean, openId: String, canMoveTo: Boolean })
const emit = defineEmits(["toggle", "edit", "remove", "move", "moveTo", "open"])

const ACTIONS = computed(() => (1 + (props.item.done ? 0 : 1) + (props.canMoveTo ? 1 : 0)) * 78)
const rowWidth = () => (rowEl.value ? rowEl.value.offsetWidth : 360)
// Past this, letting go deletes it.
const full = computed(() => -swipe.value > Math.max(ACTIONS.value + 60, rowWidth() * 0.62))
const swipe = ref(0)
const settling = ref(false)
const isOpen = computed(() => props.openId === props.item.id)
watch(isOpen, o => { if (!o) settleTo(0) })
function settleTo(x) {
  settling.value = true
  swipe.value = x
  setTimeout(() => { settling.value = false }, 220)
}

// ----- swiping -----
let x0 = 0, y0 = 0, start = 0, swiping = false, moved = false
function down(e) { x0 = e.clientX; y0 = e.clientY; start = swipe.value; swiping = false; moved = false }
function move(e) {
  const dx = e.clientX - x0, dy = e.clientY - y0
  if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
    swiping = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true
  if (swiping) {
    const was = full.value
    swipe.value = Math.max(-rowWidth(), Math.min(0, start + dx))
    if (full.value !== was && navigator.vibrate) navigator.vibrate(10)
  }
}
function up() {
  if (!swiping) return
  swiping = false
  if (full.value) {
    settleTo(-rowWidth())
    setTimeout(() => emit("remove"), 180)
    return
  }
  const open = swipe.value < -ACTIONS.value / 2
  settleTo(open ? -ACTIONS.value : 0)
  emit("open", open ? props.item.id : "")
}
function tap() {
  if (moved) return
  if (swipe.value !== 0) { emit("open", ""); return }
  if (navigator.vibrate) navigator.vibrate(8)
  emit("toggle")
}

// Actions fire on the finger lifting, not on the click after it, which iOS
// sometimes drops right after a swipe; the click then does nothing.
// A finger that slid (closing the actions) is no tap; a keyboard's click is.
let fired = 0
function act(fn, e) {
  if (moved && !(e.type === "click" && e.detail === 0)) return
  if (Date.now() - fired < 500) return
  fired = Date.now()
  fn()
}
const remove = e => act(() => emit("remove"), e)
const moveTo = e => act(() => { emit("open", ""); emit("moveTo") }, e)
const edit = e => act(startEdit, e)

// ----- editing -----
const editing = ref(false)
const text = ref("")
const field = ref(null)
async function startEdit() {
  emit("open", "")
  text.value = props.item.text
  editing.value = true
  await nextTick()
  field.value && field.value.focus()
}
function save() {
  if (!editing.value) return
  editing.value = false
  const t = text.value.trim()
  if (t && t !== props.item.text) emit("edit", t)
}

// ----- dragging by the handle -----
const drag = ref(0)
const dragging = ref(false)
const rowEl = ref(null)
let dy0 = 0
function dragDown(e) {
  dragging.value = true
  dy0 = e.clientY
  e.currentTarget.setPointerCapture(e.pointerId)
  if (navigator.vibrate) navigator.vibrate(10)
}
function dragMove(e) { if (dragging.value) drag.value = e.clientY - dy0 }
function dragUp() {
  if (!dragging.value) return
  const by = Math.round(drag.value / (rowEl.value ? rowEl.value.offsetHeight : 54))
  dragging.value = false
  drag.value = 0
  if (by) emit("move", by)
}
</script>

<template>
  <div ref="rowEl" class="item" :class="{ dragging, done: item.done }" :style="{ transform: drag ? `translateY(${drag}px)` : '' }">
    <div class="front" :class="{ settling }" :style="{ transform: `translateX(${swipe}px)` }"
         @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <button class="check" :class="{ on: ticked }" :aria-label="ticked ? 'Untick' : 'Tick'" @click="tap">
        <svg viewBox="0 0 24 24" width="26" height="26">
          <circle class="ring" cx="12" cy="12" r="10.5" />
          <circle class="fill" cx="12" cy="12" r="11" />
          <path class="mark" d="M7.6 12.3l3 3 5.8-6" />
        </svg>
      </button>
      <input v-if="editing" ref="field" v-model="text" class="edit-field" aria-label="Edit the to-do" enterkeyhint="done"
             @keydown.enter.prevent="$event.target.blur()" @keydown.esc="editing = false" @blur="save" />
      <div v-else class="text" @click="tap">{{ item.text }}</div>
      <span v-if="!item.done && !editing" class="grip" aria-label="Drag to move"
            @pointerdown.stop="dragDown" @pointermove.stop="dragMove" @pointerup.stop="dragUp" @pointercancel.stop="dragUp">
        <Icon name="grip" :size="15" />
      </span>
    </div>
    <div class="actions" :class="{ settling, full }" :style="{ width: -swipe + 'px' }"
         :aria-hidden="!swipe" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <button v-if="canMoveTo" class="act move" :tabindex="swipe ? 0 : -1" @pointerup="moveTo" @click="moveTo">
        <Icon name="move" :size="20" /><span>Move</span>
      </button>
      <button v-if="!item.done" class="act" :tabindex="swipe ? 0 : -1" @pointerup="edit" @click="edit">
        <Icon name="pencil" :size="20" /><span>Edit</span>
      </button>
      <button class="act delete" :tabindex="swipe ? 0 : -1" @pointerup="remove" @click="remove">
        <Icon name="trash" :size="20" /><span>Delete</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.item { position: relative; overflow: hidden; }
.item + .item::after { content: ""; position: absolute; top: 0; left: 54px; right: 16px; height: 1px; background: var(--sep); z-index: 2; pointer-events: none; }
.item.dragging { z-index: 10; overflow: visible; }
.item.dragging .front { box-shadow: var(--shadow); border-radius: 16px; }
/* The card's breathing room is inside its first and last rows, so the
   actions reach its very edge. */
.item:first-child .front { padding-top: 4px; }
.item:last-child .front { padding-bottom: 4px; }
/* The actions fill the room the row leaves, edge to edge. */
.actions {
  position: absolute; top: 0; right: 0; bottom: 0;
  display: flex; overflow: hidden;
  z-index: 3;
  touch-action: pan-y;
}
.actions.settling, .front.settling { transition: transform .22s cubic-bezier(.2, .8, .2, 1), width .22s cubic-bezier(.2, .8, .2, 1); }
.act { height: 100%; flex: 1 1 0; min-width: 0; padding: 0; border-radius: 0; flex-direction: column; gap: 4px;
       font-size: 13px; font-weight: 600; color: #fff; background: var(--edit); overflow: hidden;
       transition: flex-grow .2s; }
.act:active { transform: none; filter: brightness(.92); }
.act.move { background: var(--move); }
.act.delete { background: var(--danger); }
/* Swiped all the way: Delete takes the whole row. */
.actions.full .act:not(.delete) { flex-grow: 0.0001; }
.actions.full .act.delete { flex-grow: 1000; }
.front {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 54px;
  padding: 0 4px 0 6px;
  background: var(--card);
  touch-action: pan-y;
}
.check { width: 44px; height: 44px; padding: 0; background: none; border-radius: 50%; flex: none; }
.check:active { transform: scale(.88); }
.check .ring { fill: none; stroke: var(--ring); stroke-width: 2; }
.check .fill { fill: var(--accent); transform-origin: 12px 12px; transform: scale(0); transition: transform .25s cubic-bezier(.3, 1.6, .5, 1); }
.check .mark { fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round;
               stroke-dasharray: 15; stroke-dashoffset: 15; transition: stroke-dashoffset .22s .1s; }
.check.on .fill { transform: scale(1); }
.check.on .mark { stroke-dashoffset: 0; }
.text { flex: 1; padding: 15px 6px 15px 2px; word-break: break-word; cursor: pointer; transition: color .2s;
        user-select: none; -webkit-user-select: none; }
.check.on + .text, .done .text { color: var(--faint); }
.edit-field { flex: 1; height: 40px; margin-right: 8px; }
.grip { color: var(--faint); opacity: .5; padding: 12px 10px; touch-action: none; cursor: grab; display: flex; }
.grip:active { opacity: 1; }
</style>
