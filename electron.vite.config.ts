import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig(({ command }) => ({
  main: {
    build: {
      sourcemap: command === 'serve'
    }
  },
  preload: {
    build: {
      sourcemap: command === 'serve',
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    define: {
      __OMP_UI_FIXTURE__: JSON.stringify(
        command === 'serve' && process.env['OMP_UI_FIXTURE'] === '1'
      )
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      sourcemap: command === 'serve'
    },
    plugins: [react(), tailwindcss()]
  }
}))
