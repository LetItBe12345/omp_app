import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/renderer/setup.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
