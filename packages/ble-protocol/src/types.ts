export type UploadKind = "package" | "book" | "bmp" | "firmware"
export type DownloadKind = "crash_report" | "package_state"

export type TransferState =
  | "starting"
  | "advertising"
  | "connected"
  | "receiving"
  | "verifying"
  | "installing"
  | "confirming"
  | "updating"
  | "installed"
  | "saved"
  | "sending"
  | "sent"
  | "restarting"
  | "save_host_prompt"
  | "forget_host_prompt"
  | "error"
  | string

export interface TransferStatus {
  state?: TransferState
  protocol_version?: number
  firmware_name?: string
  firmware_version?: string
  browser_companion_url?: string
  upload_kinds?: UploadKind[]
  download_kinds?: DownloadKind[]
  firmware_ota_supported?: boolean
  resume_supported?: boolean
  max_download_chunk_size?: number
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
  resumable?: boolean
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

export interface SaveHostCommand {
  op: "save_host"
  host_id: string
  host_name: string
  secret: string
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
  | SaveHostCommand
  | StartPutCommand
  | StartGetCommand
  | GetAckCommand
  | { op: "commit" }
  | { op: "cancel" }
