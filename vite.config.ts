import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  build: {
    outDir: 'web-dist',
    emptyOutDir: true,
  },
  plugins: [vue()],
})
