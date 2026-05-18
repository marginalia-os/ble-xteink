export type UploadKind = "package" | "book" | "bmp" | "firmware"
export type DownloadKind = "crash_report" | "package_state"

export type TransferState =
  | "advertising"
  | "connected"
  | "receiving"
  | "verifying"
  | "confirming"
  | "updating"
  | "installed"
  | "saved"
  | "sent"
  | "restarting"
  | "error"
  | string

export interface TransferStatus {
  state?: TransferState
  device_id?: string
  device_nonce?: string
  has_trusted_host?: boolean
  trusted_host?: string
  received?: number
  sent?: number
  written?: number
  size?: number
  path?: string
  name?: string
  package?: string
  error?: string
  paired?: boolean
  pairing?: string
  ack_bytes?: number
}

export interface CodeHelloCommand {
  op: "hello"
  version: 1
  code: string
  pair_host_id?: string
  pair_host_name?: string
  pair_secret?: string
}

export interface TrustedHelloCommand {
  op: "hello"
  version: 1
  host_id: string
  response: string
}

export interface StartPutCommand {
  op: "start_put"
  kind: UploadKind
  name: string
  size: number
  sha256: string
  resume: boolean
  chunk_size: number
  ack_bytes?: number
}

export interface StartGetCommand {
  op: "start_get"
  kind: DownloadKind
  package_id?: string
  offset?: number
  chunk_size?: number
}

export interface GetAckCommand {
  op: "get_ack"
  sequence: number
}

export type ControlCommand =
  | CodeHelloCommand
  | TrustedHelloCommand
  | StartPutCommand
  | StartGetCommand
  | GetAckCommand
  | { op: "commit" }
  | { op: "cancel" }
