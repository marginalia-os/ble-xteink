import { describe, expect, it } from "vitest"

import { DATA_FRAME_HEADER_BYTES } from "./constants"
import { decodeDataFrame, encodeDataFrame } from "./framing"

describe("data frame encoding", () => {
  it("encodes and decodes a little-endian sequence header", () => {
    const payload = new Uint8Array([1, 2, 3])
    const frame = encodeDataFrame(0x01020304, payload)

    expect(frame).toHaveLength(DATA_FRAME_HEADER_BYTES + payload.byteLength)
    expect(frame.slice(0, DATA_FRAME_HEADER_BYTES)).toEqual(
      new Uint8Array([4, 3, 2, 1])
    )
    expect(decodeDataFrame(frame)).toEqual({
      sequence: 0x01020304,
      payload,
    })
  })

  it("rejects frames without a complete sequence header", () => {
    expect(() => decodeDataFrame(new Uint8Array([1, 2, 3]))).toThrow(
      "sequence header"
    )
  })
})
