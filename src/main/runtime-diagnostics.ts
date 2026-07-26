import { appendFile, rename, stat } from 'node:fs/promises'

const REDACTIONS: Array<[RegExp, string]> = [
  [
    /(api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi,
    '$1=[REDACTED]'
  ],
  [/"message"\s*:\s*"(?:\\.|[^"\\])*"/gi, '"message":"[REDACTED]"'],
  [/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[REDACTED]@'],
  [/(proxy)\s*[:=]\s*\S+/gi, '$1=[REDACTED]']
]

export function redactRuntimeLog(value: string, maxLength = 4_096): string {
  let redacted = value.slice(0, maxLength)
  for (const [pattern, replacement] of REDACTIONS) {
    redacted = redacted.replace(pattern, replacement)
  }
  return redacted
}

export class RuntimeDiagnostics {
  #writeQueue = Promise.resolve()
  #pendingBytes = 0
  #droppedLines = 0
  #droppedBytes = 0

  constructor(
    readonly filePath: string,
    readonly maxBytes = 5 * 1024 * 1024,
    readonly maxFiles = 3,
    readonly maxPendingBytes = 1024 * 1024
  ) {}

  write(value: string): void {
    let line = `${new Date().toISOString()} ${redactRuntimeLog(value)}\n`
    let lineBytes = Buffer.byteLength(line)
    if (this.#pendingBytes + lineBytes > this.maxPendingBytes) {
      this.#droppedLines += 1
      this.#droppedBytes += lineBytes
      return
    }
    if (this.#droppedLines > 0) {
      const summary = `${new Date().toISOString()} LOG_OVERLOAD: dropped=${this.#droppedLines} bytes=${this.#droppedBytes}\n`
      const summaryBytes = Buffer.byteLength(summary)
      if (
        this.#pendingBytes + summaryBytes + lineBytes <=
        this.maxPendingBytes
      ) {
        line = summary + line
        lineBytes += summaryBytes
        this.#droppedLines = 0
        this.#droppedBytes = 0
      }
    }
    this.#pendingBytes += lineBytes
    this.#writeQueue = this.#writeQueue
      .then(async () => {
        await this.#rotateIfNeeded(Buffer.byteLength(line))
        await appendFile(this.filePath, line, { encoding: 'utf8' })
      })
      .catch(() => undefined)
      .finally(() => {
        this.#pendingBytes -= lineBytes
      })
  }

  async flush(timeoutMs = 2_000): Promise<void> {
    await Promise.race([
      this.#writeQueue,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    ])
  }

  async #rotateIfNeeded(incomingBytes: number): Promise<void> {
    const currentSize = await stat(this.filePath)
      .then((value) => value.size)
      .catch(() => 0)
    if (currentSize + incomingBytes <= this.maxBytes) return

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source =
        index === 1 ? this.filePath : `${this.filePath}.${index - 1}`
      const destination = `${this.filePath}.${index}`
      await rename(source, destination).catch(() => undefined)
    }
  }
}
