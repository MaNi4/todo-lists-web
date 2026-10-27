<script setup>
// Small line icons, drawn here so the app needs no icon font.
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 22 } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'circle'"><circle cx="12" cy="12" r="8.5" /></template>
    <template v-else-if="name === 'checked'">
      <circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" />
      <path d="M8 12.3l2.7 2.7L16.2 9.4" stroke="var(--bg)" stroke-width="2.2" />
    </template>
    <template v-else-if="name === 'check'"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'close'"><path d="M6 6l12 12M18 6L6 18" /></template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </template>
    <template v-else-if="name === 'unlock'">
      <rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
    </template>
    <template v-else-if="name === 'lists'">
      <path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
    </template>
    <template v-else-if="name === 'pencil'"><path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z M14 7l3.5 3.5" /></template>
    <template v-else-if="name === 'move'"><path d="M4 7h9 M4 12h6 M4 17h6 M14 15h7 M18 12l3 3-3 3" /></template>
    <template v-else-if="name === 'export'"><path d="M12 3v12 M7.5 7.5L12 3l4.5 4.5 M5 13v6h14v-6" /></template>
    <template v-else-if="name === 'grip'">
      <g fill="currentColor" stroke="none">
        <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" />
        <circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
      </g>
    </template>
    <template v-else-if="name === 'back'"><path d="M15 5l-7 7 7 7" /></template>
    <template v-else-if="name === 'right'"><path d="M9 5l7 7-7 7" /></template>
    <template v-else-if="name === 'down'"><path d="M5 9l7 7 7-7" /></template>
    <template v-else-if="name === 'cloud'"><path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18.5z" /></template>
    <template v-else-if="name === 'cloud-ok'">
      <path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18.5z" /><path d="M9.5 14l1.8 1.8 3.5-3.6" />
    </template>
    <template v-else-if="name === 'cloud-off'">
      <path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18.5z" /><path d="M4 4l16 16" />
    </template>
    <template v-else-if="name === 'cloud-alert'">
      <path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18.5z" /><path d="M12 10.5v3M12 16v.01" />
    </template>
    <template v-else-if="name === 'sync'">
      <path d="M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7M17.5 3.5v4h-4M6.5 20.5v-4h4" />
    </template>
    <template v-else-if="name === 'copy'"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></template>
    <template v-else-if="name === 'key'"><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" /></template>
  </svg>
</template>
