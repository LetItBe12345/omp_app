import { test as base, expect, _electron } from '@playwright/test'
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

export const test = base.extend({
  // Playwright 要求 fixture 参数使用对象解构。
  // eslint-disable-next-line no-empty-pattern
  desktop: async ({}, use, testInfo) => {
    const root = await mkdtemp(join(tmpdir(), 'omp-playwright-'))
    const workspace = join(root, 'workspace')
    // 和应用 getSessionDirectory 的 /tmp Workspace 规则一致。
    const sessions = join(
      homedir(),
      '.omp/agent/sessions',
      `-tmp-${relative(tmpdir(), workspace).replace(/[/\\:]/gu, '-')}`
    )
    const sessionDirectories = [sessions]
    let application
    let page
    const errors = []
    try {
      await mkdir(workspace, { recursive: true })
      await mkdir(join(root, 'runtime'))
      await mkdir(join(root, 'config'))
      // 废纸篓与 Session 文件必须位于同一文件系统。
      await mkdir(join(sessions, 'data'), { recursive: true, mode: 0o700 })
      await cp(resolve('out'), join(root, 'out'), { recursive: true })
      await cp(resolve('tests/fixtures/e2e-omp.mjs'), join(root, 'runtime/omp'))
      await chmod(join(root, 'runtime/omp'), 0o755)
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ type: 'module' })
      )
      await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined)
      )
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      application = await _electron.launch({
        args: [
          resolve('tests/helpers/e2e-main.mjs'),
          ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
        ],
        env: {
          ...env,
          SHELL: '/bin/sh',
          XDG_DATA_HOME: join(sessions, 'data'),
          OMP_E2E_ROOT: root,
          OMP_E2E_RPC_LOG: join(root, 'rpc.jsonl')
        }
      })
      await application
        .context()
        .tracing.start({ screenshots: true, snapshots: true, sources: true })
      page = await application.firstWindow()
      await page.setViewportSize({ width: 1440, height: 900 })
      page.on('pageerror', (error) => errors.push(error.message))
      await page.evaluate(() => {
        globalThis.e2eEvents = []
        globalThis.desktop.onRuntimeEvent((event) =>
          globalThis.e2eEvents.push(event)
        )
      })
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path]
        })
      }, workspace)
      await page
        .getByRole('button', { name: '打开 Workspace', exact: true })
        .click()
      await expect(
        page.getByRole('textbox', { name: '任务输入' })
      ).toBeEnabled()
      await expect(
        page.getByRole('button', { name: '打开 Workspace', exact: true })
      ).toBeEnabled()
      await page.getByRole('button', { name: '新建对话', exact: true }).click()
      const readState = async () =>
        JSON.parse(
          await readFile(
            join(root, 'config/OMP Desktop/desktop-state.json'),
            'utf8'
          )
        )
      const rpc = async () =>
        (await readFile(join(root, 'rpc.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      const openWorkspace = async (path) => {
        await mkdir(path, { recursive: true })
        const directory = join(
          homedir(),
          '.omp/agent/sessions',
          `-tmp-${relative(tmpdir(), path).replace(/[/\\:]/gu, '-')}`
        )
        if (!sessionDirectories.includes(directory))
          sessionDirectories.push(directory)
        await application.evaluate(({ dialog }, selectedPath) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [selectedPath]
          })
        }, path)
        await page
          .getByRole('button', { name: '打开 Workspace', exact: true })
          .click()
        await expect
          .poll(async () => {
            const state = await readState()
            return state.workspaces.find(
              (item) => item.id === state.activeWorkspaceId
            )?.path
          })
          .toBe(path)
        await expect(
          page.getByRole('button', { name: '打开 Workspace', exact: true })
        ).toBeEnabled()
      }
      await use({
        application,
        page,
        readState,
        rpc,
        sessions,
        root,
        workspace,
        openWorkspace
      })
      expect(errors, 'Renderer 不应产生未捕获错误').toEqual([])
    } finally {
      try {
        if (application) {
          try {
            if (testInfo.status !== testInfo.expectedStatus) {
              if (page && !page.isClosed())
                await page.screenshot({
                  path: testInfo.outputPath('failure.png')
                })
              await application
                .context()
                .tracing.stop({ path: testInfo.outputPath('trace.zip') })
              await testInfo.attach('events', {
                body: JSON.stringify(
                  await page.evaluate(() => globalThis.e2eEvents),
                  null,
                  2
                ),
                contentType: 'application/json'
              })
              await testInfo.attach('rpc', {
                body: await readFile(join(root, 'rpc.jsonl')).catch(() =>
                  Buffer.from('')
                ),
                contentType: 'text/plain'
              })
            } else {
              await application.context().tracing.stop()
            }
          } finally {
            // 测试失败时也退出正在执行任务的窗口，避免退出确认框阻塞清理。
            await application.evaluate(({ BrowserWindow }) => {
              for (const window of BrowserWindow.getAllWindows())
                window.destroy()
            })
            await application.close()
          }
        }
      } finally {
        await Promise.all(
          sessionDirectories.map((directory) =>
            rm(directory, { recursive: true, force: true })
          )
        )
        await rm(root, { recursive: true, force: true })
      }
    }
  }
})
export { expect }

export async function submit(page, message) {
  await page.getByRole('textbox', { name: '任务输入' }).fill(message)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

export async function completeSession(page, message) {
  await submit(page, message)
  await expect(
    page.getByText('E2E 命令执行完成', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '发送', exact: true })
  ).toBeVisible()
  const row = page.locator('[data-session-id][aria-current="true"]')
  await expect(row).toContainText(message)
  return row.getAttribute('data-session-id')
}
