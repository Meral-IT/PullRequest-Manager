import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import config from './electron.vite.config.mts'

export default defineConfig({
  ...config,
  main: {
    ...config.main,
    build: {
      ...config.main?.build,
      outDir: 'temp/profile-main',
      rolldownOptions: {
        input: { main: resolve(import.meta.dirname, 'scripts/profile/main.mjs') },
        output: { chunkFileNames: '[name]-[hash].js' },
      },
    },
  },
})
