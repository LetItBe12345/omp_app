const NEWLINE = 0x0a

export class JsonlFrameTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`RPC JSONL frame exceeds ${limitBytes} bytes`)
    this.name = 'JsonlFrameTooLargeError'
  }
}

export class JsonlDecoder {
  #buffer: Buffer = Buffer.alloc(0)

  constructor(readonly maxFrameBytes = 16 * 1024 * 1024) {}

  push(chunk: Buffer | string): string[] {
    const incoming = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    this.#buffer =
      this.#buffer.length === 0
        ? incoming
        : Buffer.concat([this.#buffer, incoming])

    const lines: string[] = []
    let start = 0

    for (let index = 0; index < this.#buffer.length; index += 1) {
      if (this.#buffer[index] !== NEWLINE) continue

      const length = index - start
      if (length > this.maxFrameBytes) {
        this.reset()
        throw new JsonlFrameTooLargeError(this.maxFrameBytes)
      }

      const line = this.#buffer.subarray(start, index).toString('utf8')
      if (line.trim()) lines.push(line)
      start = index + 1
    }

    this.#buffer = this.#buffer.subarray(start)
    if (this.#buffer.length > this.maxFrameBytes) {
      this.reset()
      throw new JsonlFrameTooLargeError(this.maxFrameBytes)
    }

    return lines
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0)
  }

  get bufferedBytes(): number {
    return this.#buffer.length
  }
}
