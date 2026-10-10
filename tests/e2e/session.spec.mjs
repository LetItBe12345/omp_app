import { readdir } from 'node:fs/promises'
import { test, expect, submit, completeSession } from './fixtures.mjs'

test('新建 Session：清空对话，首条消息后生成独立会话', async ({ desktop }) => {
  const { page, readState } = desktop
  const first = await completeSession(page, '第一个 Session')
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '任务输入' })).toHaveValue('')
  await expect(page.getByText('E2E 命令执行完成', { exact: true })).toHaveCount(
    0
  )
  const second = await completeSession(page, '第二个 Session')
  expect(second).not.toBe(first)
  await expect(page.locator('[data-session-id]')).toHaveCount(2)
  await expect
    .poll(async () => (await readState()).workspaces[0].activeSessionId)
    .toBe(second)
})

test('更换 Agent 权限：三档切换并持久化，重载后保留', async ({ desktop }) => {
  const { page, readState, rpc } = desktop
  const id = await completeSession(page, '权限测试 Session')
  for (const [label, mode] of [
    ['标准', 'write'],
    ['全部允许', 'yolo'],
    ['严格', 'always-ask']
  ]) {
    await page.getByRole('button', { name: '选择权限', exact: true }).click()
    await page.getByRole('menuitemradio', { name: label, exact: true }).click()
    await expect(
      page.getByRole('button', { name: '选择权限', exact: true })
    ).toHaveText(`权限：${label}`)
    await expect
      .poll(
        async () =>
          Object.values((await readState()).sessionPreferences)[0]?.[id]
            ?.approvalMode
      )
      .toBe(mode)
    await expect
      .poll(
        async () =>
          (await rpc()).filter((item) => item.type === 'startup').at(-1)?.mode
      )
      .toBe(mode)
  }
  await page.reload()
  await expect(
    page.getByRole('button', { name: '选择权限', exact: true })
  ).toHaveText('权限：严格')
  await expect(
    page.getByText('E2E 命令执行完成', { exact: true })
  ).toBeVisible()
})

test('输入 Slash 命令：显示候选，发送到 RPC 并展示执行结果', async ({
  desktop
}) => {
  const { page, rpc } = desktop
  await page.getByRole('textbox', { name: '任务输入' }).fill('/e2')
  await expect(page.getByRole('listbox', { name: 'Slash 命令' })).toContainText(
    '/e2e'
  )
  await page.getByRole('textbox', { name: '任务输入' }).press('Escape')
  await submit(page, '/e2e hello')
  await expect(
    page.getByText('E2E 命令执行完成', { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '任务输入' })).toHaveValue('')
  await expect
    .poll(
      async () =>
        (await rpc()).filter((item) => item.type === 'prompt').at(-1)?.message
    )
    .toBe('/e2e hello')
})

test('任务运行中取消：发送 abort、恢复输入并允许再次执行', async ({
  desktop
}) => {
  const { page, rpc } = desktop
  await submit(page, '/e2e long-running')
  await expect(
    page.getByRole('button', { name: '停止', exact: true })
  ).toBeEnabled()
  await expect(
    page.locator('[data-session-id][aria-current="true"]')
  ).toHaveAttribute('data-session-phase', 'running')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止', exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '任务输入' })).toHaveValue(
    '/e2e long-running'
  )
  await expect
    .poll(async () => (await rpc()).some((item) => item.type === 'abort'))
    .toBe(true)
  await expect(page.getByText('E2E 任务已中止', { exact: true })).toBeVisible()
  await submit(page, '/e2e after-cancel')
  await expect(
    page.getByText('E2E 命令执行完成', { exact: true })
  ).toBeVisible()
})

test('删除 Session：取消确认时保留，确认后移除列表、文件和偏好', async ({
  desktop
}) => {
  const { page, sessions, readState } = desktop
  const id = await completeSession(page, '待删除 Session')
  const row = page.locator(`[data-session-id="${id}"]`)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('将此会话移入系统废纸篓？')
    await dialog.dismiss()
  })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  await expect(row).toBeVisible()
  expect(await readdir(sessions)).toContain(`${id}.jsonl`)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('将此会话移入系统废纸篓？')
    await dialog.accept()
  })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect.poll(() => readdir(sessions)).not.toContain(`${id}.jsonl`)
  await expect
    .poll(
      async () => Object.values((await readState()).sessionPreferences)[0]?.[id]
    )
    .toBeUndefined()
  await expect(page.getByRole('textbox', { name: '任务输入' })).toBeEnabled()
})
