import { describe, expect, it } from 'vitest'
import {
  JsonlDecoder,
  JsonlFrameTooLargeError
} from '../../src/main/jsonl-decoder'

describe('JsonlDecoder', () => {
  it('处理分包、粘包、空行和残留缓冲', () => {
    const decoder = new JsonlDecoder()

    expect(decoder.push('{"type":"rea')).toEqual([])
    expect(decoder.bufferedBytes).toBeGreaterThan(0)
    expect(
      decoder.push('dy"}\n\n{"type":"response"}\n{"type":"partial"')
    ).toEqual(['{"type":"ready"}', '{"type":"response"}'])
    expect(decoder.push('}\n')).toEqual(['{"type":"partial"}'])
    expect(decoder.bufferedBytes).toBe(0)
  })

  it('拒绝超过上限的完整帧和未完成帧', () => {
    expect(() => new JsonlDecoder(4).push('12345')).toThrow(
      JsonlFrameTooLargeError
    )
    expect(() => new JsonlDecoder(4).push('12345\n')).toThrow(
      JsonlFrameTooLargeError
    )
  })
})
