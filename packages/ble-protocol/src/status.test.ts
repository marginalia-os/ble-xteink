import { describe, expect, it } from "vitest"

import { decodeStatus, progressBytes } from "./status"

describe("status helpers", () => {
  it("decodes UTF-8 JSON status payloads", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ state: "receiving", received: 12, size: 24 })
    )

    expect(decodeStatus(bytes.buffer)).toEqual({
      state: "receiving",
      received: 12,
      size: 24,
    })
  })

  it("uses the current transfer byte field", () => {
    expect(progressBytes({ received: 10, written: 20, sent: 30 })).toBe(10)
    expect(progressBytes({ written: 20, sent: 30 })).toBe(20)
    expect(progressBytes({ sent: 30 })).toBe(30)
  })
})
