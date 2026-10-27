import { createApp } from "vue"
import App from "./App.vue"

// Never inside another page's frame, where its taps could be stolen
// (GitHub Pages cannot send frame-ancestors).
if (window.top !== window.self) {
  document.body.textContent = "To-Do Lists does not run inside another page."
  throw new Error("framed")
}

createApp(App).mount("#app")

// Offline: the app's own files are kept by a service worker (public/sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {})
}
