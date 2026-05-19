export function trustedHostMessage(
  deviceNonce: string,
  hostId: string
): string {
  return `${deviceNonce}|${hostId}|1`
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return bytesToHex(new Uint8Array(digest))
}

export async function trustedHostResponse(
  secret: string,
  deviceNonce: string,
  hostId: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(trustedHostMessage(deviceNonce, hostId))
  )
  return bytesToHex(new Uint8Array(signature))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}
