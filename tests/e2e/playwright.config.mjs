import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  outputDir: '../artifacts/e2e/results',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../artifacts/e2e/report', open: 'never' }]
  ]
})
