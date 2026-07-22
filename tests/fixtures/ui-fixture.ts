export const uiFixture = {
  workspace: 'omp-desktop',
  conversations: ['实现 Desktop UI', '确认 RPC 执行边界', '完善产品文档'],
  files: ['src', 'docs', 'TODO', 'package.json', 'README.md'],
  activeConversation: '实现 Desktop UI',
  userMessage: '按设计图实现 OMP Desktop 的三栏基础界面。',
  assistantMessage:
    '已建立三栏结构。左侧显示 Workspace 和对话概览，中间显示文件树，右侧保留对话主区。'
} as const
