import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

// Relative paths: the app works wherever GitHub Pages serves it.
export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: { target: "es2022", assetsInlineLimit: 0 },
})
