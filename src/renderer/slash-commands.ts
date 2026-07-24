import type {
  AvailableSlashCommand,
  AvailableSlashSubcommand
} from '../shared/desktop-api'

const AVAILABLE_COMMAND_SOURCES = new Set([
  'builtin',
  'skill',
  'extension',
  'custom',
  'mcp_prompt',
  'file'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: string): string {
  return value.toLocaleLowerCase()
}

function exactMatchesCommand(
  command: AvailableSlashCommand,
  token: string
): boolean {
  const normalized = normalize(token)
  return (
    normalize(command.name) === normalized ||
    (command.aliases ?? []).some((alias) => normalize(alias) === normalized)
  )
}

function prefixMatchesCommand(
  command: AvailableSlashCommand,
  token: string
): boolean {
  const normalized = normalize(token)
  if (!normalized) return true
  return (
    normalize(command.name).startsWith(normalized) ||
    (command.aliases ?? []).some((alias) =>
      normalize(alias).startsWith(normalized)
    )
  )
}

function rankedCommands(
  commands: readonly AvailableSlashCommand[],
  token: string
): AvailableSlashCommand[] {
  const matches = commands.filter((command) => prefixMatchesCommand(command, token))
  const exact = matches.filter((command) => exactMatchesCommand(command, token))
  return exact.length > 0
    ? [...exact, ...matches.filter((command) => !exact.includes(command))]
    : matches
}

function rankedSubcommands(
  subcommands: readonly AvailableSlashSubcommand[],
  token: string
): AvailableSlashSubcommand[] {
  const normalized = normalize(token)
  const matches = subcommands.filter(
    (subcommand) =>
      !normalized || normalize(subcommand.name).startsWith(normalized)
  )
  const exact = matches.filter(
    (subcommand) => normalize(subcommand.name) === normalized
  )
  return exact.length > 0
    ? [...exact, ...matches.filter((subcommand) => !exact.includes(subcommand))]
    : matches
}

function parseLeadingSlashInput(input: string): {
  leadingWhitespace: string
  trimmed: string
  firstToken: string
  firstSpaceIndex: number
  restAfterFirstToken: string
} | null {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return null
  const leadingWhitespace = input.slice(0, input.length - trimmed.length)
  const body = trimmed.slice(1)
  const firstSpaceIndex = body.search(/\s/u)
  const firstToken = firstSpaceIndex < 0 ? body : body.slice(0, firstSpaceIndex)
  const restAfterFirstToken = firstSpaceIndex < 0 ? '' : body.slice(firstSpaceIndex)
  return {
    leadingWhitespace,
    trimmed,
    firstToken,
    firstSpaceIndex,
    restAfterFirstToken
  }
}

export function validateAvailableCommands(
  value: unknown
): AvailableSlashCommand[] | null {
  const data = isRecord(value) ? value : {}
  if (!Array.isArray(data['commands'])) return null
  const commands = data['commands'].map((command) => {
    if (
      !isRecord(command) ||
      typeof command['name'] !== 'string' ||
      typeof command['source'] !== 'string' ||
      !AVAILABLE_COMMAND_SOURCES.has(command['source'])
    ) {
      return null
    }
    if (
      command['aliases'] !== undefined &&
      (!Array.isArray(command['aliases']) ||
        !command['aliases'].every((alias) => typeof alias === 'string'))
    ) {
      return null
    }
    if (
      command['input'] !== undefined &&
      (!isRecord(command['input']) ||
        (command['input']['hint'] !== undefined &&
          typeof command['input']['hint'] !== 'string'))
    ) {
      return null
    }
    if (
      command['subcommands'] !== undefined &&
      (!Array.isArray(command['subcommands']) ||
        command['subcommands'].some(
          (subcommand) =>
            !isRecord(subcommand) ||
            typeof subcommand['name'] !== 'string' ||
            (subcommand['description'] !== undefined &&
              typeof subcommand['description'] !== 'string') ||
            (subcommand['usage'] !== undefined &&
              typeof subcommand['usage'] !== 'string')
        ))
    ) {
      return null
    }
    return {
      name: command['name'],
      ...(Array.isArray(command['aliases'])
        ? { aliases: command['aliases'] as string[] }
        : {}),
      ...(typeof command['description'] === 'string'
        ? { description: command['description'] }
        : {}),
      ...(isRecord(command['input']) && typeof command['input']['hint'] === 'string'
        ? { input: { hint: command['input']['hint'] } }
        : {}),
      ...(Array.isArray(command['subcommands'])
        ? {
            subcommands: command['subcommands'].map((subcommand) => ({
              name: (subcommand as Record<string, unknown>)['name'] as string,
              ...((subcommand as Record<string, unknown>)['description']
                ? {
                    description: (subcommand as Record<string, unknown>)[
                      'description'
                    ] as string
                  }
                : {}),
              ...((subcommand as Record<string, unknown>)['usage']
                ? {
                    usage: (subcommand as Record<string, unknown>)[
                      'usage'
                    ] as string
                  }
                : {})
            }))
          }
        : {}),
      source: command['source']
    } satisfies AvailableSlashCommand
  })
  return commands.every((command) => command !== null)
    ? (commands as AvailableSlashCommand[])
    : null
}

export function findExactSlashCommand(
  commands: readonly AvailableSlashCommand[],
  token: string
): AvailableSlashCommand | undefined {
  return commands.find((command) => exactMatchesCommand(command, token))
}

export function preparePromptSubmission(
  input: string,
  commands: readonly AvailableSlashCommand[]
): {
  message: string
  displayText: string
  isSlash: boolean
  exactCommand?: AvailableSlashCommand
} {
  const parsed = parseLeadingSlashInput(input)
  if (!parsed) {
    const message = input.trim()
    return { message, displayText: message, isSlash: false }
  }
  const exactCommand = findExactSlashCommand(commands, parsed.firstToken)
  if (!exactCommand) {
    return {
      message: input,
      displayText: input,
      isSlash: true
    }
  }
  const message = `/${exactCommand.name}${parsed.restAfterFirstToken}`
  return {
    message,
    displayText: message,
    isSlash: true,
    exactCommand
  }
}

export type SlashMenuModel =
  | {
      level: 'command'
      query: string
      candidates: AvailableSlashCommand[]
    }
  | {
      level: 'subcommand'
      query: string
      command: AvailableSlashCommand
      candidates: AvailableSlashSubcommand[]
    }

export function getSlashMenuModel(
  input: string,
  selectionStart: number | null | undefined,
  commands: readonly AvailableSlashCommand[]
): SlashMenuModel | null {
  const parsed = parseLeadingSlashInput(input)
  if (!parsed) return null
  const caret = selectionStart ?? input.length
  const firstTokenStart = parsed.leadingWhitespace.length + 1
  const firstTokenEnd = firstTokenStart + parsed.firstToken.length
  if (caret < firstTokenStart) return null
  if (caret <= firstTokenEnd || parsed.firstSpaceIndex < 0) {
    const candidates = rankedCommands(commands, parsed.firstToken)
    return candidates.length > 0 || parsed.firstToken.length === 0
      ? {
          level: 'command',
          query: parsed.firstToken,
          candidates
        }
      : null
  }
  const command = findExactSlashCommand(commands, parsed.firstToken)
  if (!command?.subcommands?.length) return null
  const subcommandText = parsed.trimmed
    .slice(1)
    .slice(parsed.firstSpaceIndex + 1)
  const secondSpaceIndex = subcommandText.search(/\s/u)
  const secondToken =
    secondSpaceIndex < 0 ? subcommandText : subcommandText.slice(0, secondSpaceIndex)
  const secondTokenStart = firstTokenEnd + 1
  const secondTokenEnd = secondTokenStart + secondToken.length
  if (caret < secondTokenStart || caret > secondTokenEnd) return null
  const candidates = rankedSubcommands(command.subcommands, secondToken)
  return candidates.length > 0 || secondToken.length === 0
    ? {
        level: 'subcommand',
        query: secondToken,
        command,
        candidates
      }
    : null
}

export function fillSlashCommand(command: AvailableSlashCommand): string {
  return `/${command.name} `
}

export function fillSlashSubcommand(
  command: AvailableSlashCommand,
  subcommand: AvailableSlashSubcommand
): string {
  return `/${command.name} ${subcommand.name} `
}

export function submitSlashCommand(command: AvailableSlashCommand): string {
  return `/${command.name}`
}

export function submitSlashSubcommand(
  command: AvailableSlashCommand,
  subcommand: AvailableSlashSubcommand
): string {
  return `/${command.name} ${subcommand.name}`
}
