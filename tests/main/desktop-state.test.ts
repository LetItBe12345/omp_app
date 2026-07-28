// @vitest-environment node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DesktopStateStore } from '../../src/main/desktop-state'

describe('DesktopStateStore', () => {
  it('全局保存代理模式并保留上次手动端口', async () => {
    const root = join(tmpdir(), `omp-network-${process.pid}-${Date.now()}`)
    await mkdir(root, { recursive: true })
    const path = join(root, 'desktop-state.json')
    const store = new DesktopStateStore(path)
    await store.load()
    expect(store.runtimeNetworkConfig()).toEqual({ mode: 'auto' })

    await store.setRuntimeNetworkConfig({ mode: 'manual', manualPort: 7890 })
    await store.setRuntimeNetworkConfig({ mode: 'off', manualPort: 7890 })

    const reloaded = new DesktopStateStore(path)
    await reloaded.load()
    expect(reloaded.runtimeNetworkConfig()).toEqual({
      mode: 'off',
      manualPort: 7890
    })
  })

  it('生成稳定 Workspace ID 并使用 0600 原子配置', async () => {
    const root = join(tmpdir(), `omp-state-${process.pid}-${Date.now()}`)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const path = join(root, 'desktop-state.json')
    const store = new DesktopStateStore(path)
    await store.load()
    const first = await store.addWorkspace(workspace)
    const second = await store.addWorkspace(workspace)
    expect(second.id).toBe(first.id)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      version: 1,
      activeWorkspaceId: first.id
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('迁移旧 runtime-state 且归档与置顶互斥', async () => {
    const root = join(tmpdir(), `omp-state-legacy-${process.pid}-${Date.now()}`)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const legacy = join(root, 'runtime-state.json')
    await writeFile(legacy, JSON.stringify({ workspacePath: workspace }))
    const store = new DesktopStateStore(
      join(root, 'desktop-state.json'),
      legacy
    )
    const state = await store.load()
    const workspaceId = state.activeWorkspaceId!
    await store.updateSessionPreference(workspaceId, 'session', {
      pinned: true
    })
    await store.updateSessionPreference(workspaceId, 'session', {
      archived: true,
      pinned: false
    })
    expect(store.sessionPreference(workspaceId, 'session')).toMatchObject({
      pinned: false,
      archived: true
    })
  })

  it('原子写入失败时恢复内存中的旧状态', async () => {
    const root = join(
      tmpdir(),
      `omp-state-failure-${process.pid}-${Date.now()}`
    )
    const workspace = join(root, 'workspace')
    const invalidStatePath = join(root, 'state-as-directory')
    await mkdir(workspace, { recursive: true })
    await mkdir(invalidStatePath)
    const store = new DesktopStateStore(invalidStatePath)
    await expect(store.addWorkspace(workspace)).rejects.toThrow()
    expect(store.state.workspaces).toEqual([])
  })

  it('按 Workspace 和 Session 隔离权限并忽略未知值', async () => {
    const root = join(
      tmpdir(),
      `omp-state-approval-${process.pid}-${Date.now()}`
    )
    const firstPath = join(root, 'first')
    const secondPath = join(root, 'second')
    await mkdir(firstPath, { recursive: true })
    await mkdir(secondPath, { recursive: true })
    const statePath = join(root, 'desktop-state.json')
    const store = new DesktopStateStore(statePath)
    await store.load()
    const first = await store.addWorkspace(firstPath)
    const second = await store.addWorkspace(secondPath)
    await store.updateSessionPreference(first.id, 'same-id', {
      approvalMode: 'always-ask'
    })
    await store.updateSessionPreference(second.id, 'same-id', {
      approvalMode: 'write'
    })

    expect(store.sessionPreference(first.id, 'same-id').approvalMode).toBe(
      'always-ask'
    )
    expect(store.sessionPreference(second.id, 'same-id').approvalMode).toBe(
      'write'
    )

    const raw = JSON.parse(await readFile(statePath, 'utf8'))
    raw.sessionPreferences[first.id]['invalid'] = { approvalMode: 'unsafe' }
    await writeFile(statePath, JSON.stringify(raw))
    const reloaded = new DesktopStateStore(statePath)
    await reloaded.load()
    expect(
      reloaded.sessionPreference(first.id, 'invalid').approvalMode
    ).toBeUndefined()
  })

  it('只清除仍然匹配的活动 Session，并保留 Session 偏好', async () => {
    const root = join(
      tmpdir(),
      `omp-state-session-${process.pid}-${Date.now()}`
    )
    const workspacePath = join(root, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const store = new DesktopStateStore(join(root, 'desktop-state.json'))
    await store.load()
    const workspace = await store.addWorkspace(workspacePath)
    await store.updateSessionPreference(workspace.id, 'stale-session', {
      pinned: true,
      approvalMode: 'write'
    })
    await store.setActiveSession(workspace.id, 'stale-session')

    expect(
      await store.clearActiveSessionIfMatches(workspace.id, 'other-session')
    ).toBe(false)
    expect(store.requireWorkspace(workspace.id).activeSessionId).toBe(
      'stale-session'
    )
    expect(
      await store.clearActiveSessionIfMatches(workspace.id, 'stale-session')
    ).toBe(true)
    expect(store.requireWorkspace(workspace.id).activeSessionId).toBeUndefined()
    expect(store.sessionPreference(workspace.id, 'stale-session')).toEqual({
      pinned: true,
      approvalMode: 'write'
    })
  })

  it('Workspace 按创建时间稳定排序，激活后不交换位置', async () => {
    const root = join(tmpdir(), `omp-state-order-${process.pid}-${Date.now()}`)
    const statePath = join(root, 'desktop-state.json')
    await mkdir(root, { recursive: true })
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        activeWorkspaceId: 'old',
        workspaces: [
          {
            id: 'old',
            path: '/workspace/old',
            addedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-07-24T12:00:00.000Z',
            pinned: false
          },
          {
            id: 'new',
            path: '/workspace/new',
            addedAt: '2026-03-01T00:00:00.000Z',
            lastUsedAt: '2026-07-23T12:00:00.000Z',
            pinned: false
          },
          {
            id: 'pinned',
            path: '/workspace/pinned',
            addedAt: '2025-01-01T00:00:00.000Z',
            lastUsedAt: '2025-01-01T00:00:00.000Z',
            pinned: true
          }
        ],
        sessionPreferences: {},
        ui: {}
      })
    )
    const store = new DesktopStateStore(statePath)
    await store.load()
    const availability = new Map([
      ['old', true],
      ['new', true],
      ['pinned', true]
    ])
    const order = () =>
      store
        .overview(availability, 0, Date.parse('2026-07-24T12:00:00.000Z'))
        .workspaces.map((workspace) => workspace.id)

    expect(order()).toEqual(['pinned', 'new', 'old'])
    await store.activateWorkspace('new')
    expect(order()).toEqual(['pinned', 'new', 'old'])
    await store.activateWorkspace('old')
    expect(order()).toEqual(['pinned', 'new', 'old'])
  })
})
