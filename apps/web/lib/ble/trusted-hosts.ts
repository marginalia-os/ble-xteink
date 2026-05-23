import { trustedHostResponse } from "@workspace/ble-protocol"
import type {
  CodeHelloCommand,
  SaveHostCommand,
  TransferStatus,
  TrustedHelloCommand,
} from "@workspace/ble-protocol"

const STORAGE_KEY = "ble-xteink.trusted-hosts.v1"
const HOST_NAME = "Browser"

export interface TrustedHostRecord {
  createdAt: string
  deviceId: string
  hostId: string
  hostName: string
  lastUsedAt: string
  secret: string
}

export interface PendingTrustedHost {
  command: CodeHelloCommand
  saveCommand: SaveHostCommand
  record: TrustedHostRecord
}

export function getTrustedHost(
  deviceId: string | undefined
): TrustedHostRecord | null {
  if (!deviceId) return null
  return readTrustedHosts()[deviceId] ?? null
}

export function rememberTrustedHost(record: TrustedHostRecord) {
  const records = readTrustedHosts()
  records[record.deviceId] = {
    ...record,
    lastUsedAt: new Date().toISOString(),
  }
  writeTrustedHosts(records)
}

export function forgetTrustedHost(deviceId: string | undefined) {
  if (!deviceId) return
  const records = readTrustedHosts()
  delete records[deviceId]
  writeTrustedHosts(records)
}

export async function createTrustedHello(
  status: TransferStatus
): Promise<TrustedHelloCommand | null> {
  const deviceId = status.device_id
  const deviceNonce = status.device_nonce
  const record = getTrustedHost(deviceId)
  if (!record || !deviceNonce) return null

  const response = await trustedHostResponse(
    record.secret,
    deviceNonce,
    record.hostId
  )
  return {
    op: "hello",
    version: 1,
    host_id: record.hostId,
    response,
  }
}

export function createPairingHello(
  status: TransferStatus,
  code: string
): PendingTrustedHost | null {
  if (!status.device_id) return null

  const now = new Date().toISOString()
  const record: TrustedHostRecord = {
    createdAt: now,
    deviceId: status.device_id,
    hostId: crypto.randomUUID(),
    hostName: HOST_NAME,
    lastUsedAt: now,
    secret: randomHex(32),
  }

  return {
    record,
    command: {
      op: "hello",
      version: 1,
      code,
      pair_host_id: record.hostId,
      pair_host_name: record.hostName,
      pair_secret: record.secret,
    },
    saveCommand: {
      op: "save_host",
      host_id: record.hostId,
      host_name: record.hostName,
      secret: record.secret,
    },
  }
}

function readTrustedHosts(): Record<string, TrustedHostRecord> {
  if (typeof localStorage === "undefined") return {}

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as Record<string, TrustedHostRecord>
  } catch {
    return {}
  }
}

function writeTrustedHosts(records: Record<string, TrustedHostRecord>) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}
