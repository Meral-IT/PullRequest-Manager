import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: {
          main: resolve(import.meta.dirname, 'lib/main/main.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(import.meta.dirname, 'app'),
        '@/lib': resolve(import.meta.dirname, 'lib'),
        '@/resources': resolve(import.meta.dirname, 'resources'),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          preload: resolve(import.meta.dirname, 'lib/preload/preload.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(import.meta.dirname, 'app'),
        '@/lib': resolve(import.meta.dirname, 'lib'),
        '@/resources': resolve(import.meta.dirname, 'resources'),
      },
    },
  },
  renderer: {
    root: './app',
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'app/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@/app': resolve(import.meta.dirname, 'app'),
        '@/lib': resolve(import.meta.dirname, 'lib'),
        '@/resources': resolve(import.meta.dirname, 'resources'),
      },
    },
    plugins: [react()],
  },
})
