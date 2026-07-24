import { describe, expect, it } from 'vitest'
import {
  createConversationProjection,
  reduceOmpEvent
} from '../../src/renderer/omp-event-reducer'
import {
  getSlashMenuModel,
  preparePromptSubmission,
  validateAvailableCommands
} from '../../src/renderer/slash-commands'

const commands = [
  {
    name: 'help',
    aliases: ['h'],
    description: 'show help',
    source: 'builtin' as const
  },
  {
    name: 'mcp',
    description: 'manage mcp',
    subcommands: [
      { name: 'help', usage: 'show mcp help' },
      { name: 'list', usage: 'list mcp servers' }
    ],
    source: 'mcp_prompt' as const
  }
]

describe('slash commands', () => {
  it('严格校验命令目录快照', () => {
    expect(
      validateAvailableCommands({
        commands: [
          {
            name: 'help',
            aliases: ['h'],
            description: 'show help',
            input: { hint: '[topic]' },
            subcommands: [{ name: 'list', usage: 'show list' }],
            source: 'builtin'
          }
        ]
      })
    ).toEqual([
      {
        name: 'help',
        aliases: ['h'],
        description: 'show help',
        input: { hint: '[topic]' },
        subcommands: [{ name: 'list', usage: 'show list' }],
        source: 'builtin'
      }
    ])
    expect(
      validateAvailableCommands({
        commands: [{ name: 'bad', aliases: [1], source: 'builtin' }]
      })
    ).toBeNull()
  })

  it('支持一级命令和二级子命令菜单', () => {
    expect(getSlashMenuModel('/h', 2, commands)).toMatchObject({
      level: 'command',
      query: 'h',
      candidates: [{ name: 'help' }]
    })
    expect(getSlashMenuModel('/h', 0, commands)).toMatchObject({
      level: 'command',
      query: 'h',
      candidates: [{ name: 'help' }]
    })
    expect(getSlashMenuModel('/mcp h', 6, commands)).toMatchObject({
      level: 'subcommand',
      query: 'h',
      command: { name: 'mcp' },
      candidates: [{ name: 'help' }]
    })
  })

  it('提交时规范化别名并保留未知 Slash 原文', () => {
    expect(preparePromptSubmission('   /h foo', commands)).toEqual({
      message: '/help foo',
      displayText: '/help foo',
      isSlash: true,
      exactCommand: commands[0]
    })
    expect(preparePromptSubmission('   /unknown foo', commands)).toEqual({
      message: '   /unknown foo',
      displayText: '   /unknown foo',
      isSlash: true
    })
  })

  it('归并命令输出并去掉 ANSI 控制序列', () => {
    const projection = reduceOmpEvent(
      reduceOmpEvent(
        createConversationProjection(),
        { type: 'command_output', text: '\u001B[31mred\u001B[0m\nnext' },
        1_000
      ),
      { type: 'prompt_result', agentInvoked: false },
      2_000
    )
    expect(projection.turns).toHaveLength(1)
    expect(projection.turns[0]).toMatchObject({
      role: 'assistant',
      status: 'completed',
      items: [
        {
          kind: 'artifact',
          artifact: 'command-result',
          value: 'red\nnext',
          copyText: 'red\nnext'
        }
      ]
    })
  })
})
