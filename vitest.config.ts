import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['tests/renderer/setup.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})
