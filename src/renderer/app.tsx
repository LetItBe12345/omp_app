import {
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Plus,
  Search,
  Settings2
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { uiFixture } from '../../tests/fixtures/ui-fixture'
import { strings } from './strings'

const fixture = __OMP_UI_FIXTURE__ ? uiFixture : null

function IconButton({
  label,
  icon
}: {
  label: string
  icon: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="inline-grid size-8 place-items-center rounded-lg text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-45"
      title={strings.unavailable}
      type="button"
      disabled
    >
      {icon}
    </button>
  )
}

function ConversationSidebar(): React.JSX.Element {
  return (
    <aside
      className="panel-surface flex h-full min-w-0 flex-col"
      data-slot="conversation-sidebar"
    >
      <div className="flex h-16 items-center justify-between px-5">
        <h1 className="text-[15px] font-semibold">{strings.conversations}</h1>
        <IconButton label={strings.newConversation} icon={<Plus size={17} />} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {strings.workspaces}
          </span>
          <IconButton label={strings.openWorkspace} icon={<Plus size={15} />} />
        </div>

        {fixture ? (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm shadow-xs">
              <Folder size={16} />
              <span className="truncate font-medium">{fixture.workspace}</span>
            </div>
            <p className="mt-7 mb-2 px-2 text-[11px] font-medium text-[var(--text-muted)]">
              最近
            </p>
            <ul className="space-y-1">
              {fixture.conversations.map((conversation, index) => (
                <li key={conversation}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${index === 0 ? 'bg-[var(--surface-selected)]' : ''}`}
                    type="button"
                  >
                    <MessageSquare
                      className="shrink-0 text-[var(--text-muted)]"
                      size={15}
                    />
                    <span className="truncate">{conversation}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-card mt-2" data-slot="workspace-empty-state">
            <Folder size={20} strokeWidth={1.6} />
            <p className="mt-3 text-sm font-medium">{strings.noWorkspace}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              {strings.noWorkspaceHint}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <button
          className="disabled-control w-full justify-start"
          type="button"
          disabled
        >
          <Search size={15} />
          <span>{strings.search}</span>
          <kbd className="ml-auto text-[10px] text-[var(--text-muted)]">
            Ctrl K
          </kbd>
        </button>
      </div>
    </aside>
  )
}

function FileTree(): React.JSX.Element {
  return (
    <aside className="panel-surface h-full min-w-0" data-slot="file-tree">
      <div className="flex h-16 items-center justify-between px-5">
        <h2 className="text-[15px] font-semibold">{strings.files}</h2>
        <IconButton label={strings.settings} icon={<Settings2 size={16} />} />
      </div>
      <div className="px-3">
        {fixture ? (
          <ul className="space-y-1">
            {fixture.files.map((file, index) => (
              <li
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm"
                key={file}
              >
                {index < 3 ? <Folder size={16} /> : <FileText size={16} />}
                <span>{file}</span>
                {index < 3 && <ChevronRight className="ml-auto" size={14} />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-card mt-2" data-slot="files-empty-state">
            <FileText size={20} strokeWidth={1.6} />
            <p className="mt-3 text-sm font-medium">暂无文件</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              打开 Workspace 后显示文件树。
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

function Conversation(): React.JSX.Element {
  return (
    <main
      className="flex h-full min-w-0 flex-col bg-[var(--surface-main)]"
      data-slot="conversation-main"
    >
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--border-subtle)] px-7">
        <div>
          <h2 className="text-[15px] font-semibold">
            {fixture ? fixture.activeConversation : strings.appName}
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {fixture ? fixture.workspace : '未连接 Workspace'}
          </p>
        </div>
      </header>

      <div
        className={`min-h-0 flex-1 overflow-y-auto p-8 ${fixture ? '' : 'grid place-items-center'}`}
      >
        {fixture ? (
          <div
            className="mx-auto flex max-w-4xl flex-col gap-7 pt-8"
            data-slot="fixture-messages"
          >
            <div className="ml-auto max-w-[72%] rounded-2xl bg-[var(--surface-selected)] px-4 py-3 text-sm leading-6">
              {fixture.userMessage}
            </div>
            <div className="max-w-[82%] text-sm leading-7">
              {fixture.assistantMessage}
            </div>
          </div>
        ) : (
          <section
            className="max-w-md text-center"
            data-slot="conversation-empty-state"
          >
            <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-[var(--border)] bg-white shadow-xs">
              <MessageSquare size={20} strokeWidth={1.6} />
            </div>
            <h3 className="mt-4 text-base font-semibold">
              {strings.noConversation}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {strings.noConversationHint}
            </p>
          </section>
        )}
      </div>

      <div className="shrink-0 p-5 pt-0">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[var(--border)] bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <textarea
            aria-label="任务输入"
            className="h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed"
            placeholder={strings.composerPlaceholder}
            disabled
          />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-[var(--text-muted)]">
              {strings.unavailable}
            </span>
            <button
              className="rounded-xl bg-[var(--text-primary)] px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-35"
              type="button"
              disabled
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

export function App(): React.JSX.Element {
  return (
    <div
      className="h-screen min-h-[700px] min-w-[1024px] bg-[var(--surface-app)] text-[var(--text-primary)]"
      data-slot="app-shell"
    >
      <Group className="h-full" id="desktop-layout" orientation="horizontal">
        <Panel defaultSize="18%" id="conversations" minSize={220}>
          <ConversationSidebar />
        </Panel>
        <Separator className="resize-handle" id="conversations-files" />
        <Panel defaultSize="17%" id="files" minSize={220}>
          <FileTree />
        </Panel>
        <Separator className="resize-handle" id="files-conversation" />
        <Panel defaultSize="65%" id="conversation" minSize={480}>
          <Conversation />
        </Panel>
      </Group>
    </div>
  )
}
