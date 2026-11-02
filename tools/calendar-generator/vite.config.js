import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' damit die gebaute Seite unter jedem Pfad läuft,
// z. B. https://asterics.github.io/Asterics-AAC-Helper/
export default defineConfig({
  base: './',
  plugins: [vue()]
})
