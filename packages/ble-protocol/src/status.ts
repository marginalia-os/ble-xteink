import type { TransferStatus } from "./types.js"

export function decodeStatus(value: ArrayBuffer): TransferStatus {
  const text = new TextDecoder().decode(value)
  const decoded: unknown = JSON.parse(text)
  if (!decoded || typeof decoded !== "object") {
    return { state: "unknown" }
  }
  return decoded as TransferStatus
}

export function progressBytes(status: TransferStatus): number | undefined {
  return status.received ?? status.written ?? status.sent
}
