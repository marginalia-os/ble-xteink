export const BLE_TRANSFER_SERVICE_UUID = "6f9f0a00-9b1d-4d1f-9f53-5b6b8b3d0f10"

export const BLE_TRANSFER_CHARACTERISTICS = {
  control: "6f9f0a01-9b1d-4d1f-9f53-5b6b8b3d0f10",
  dataIn: "6f9f0a02-9b1d-4d1f-9f53-5b6b8b3d0f10",
  status: "6f9f0a03-9b1d-4d1f-9f53-5b6b8b3d0f10",
  dataOut: "6f9f0a04-9b1d-4d1f-9f53-5b6b8b3d0f10",
} as const

export const DATA_FRAME_HEADER_BYTES = 4
export const DEFAULT_UPLOAD_CHUNK_BYTES = 160
export const DEFAULT_FIRMWARE_UPLOAD_CHUNK_BYTES = 500
export const DEFAULT_DOWNLOAD_CHUNK_BYTES = 160
export const MIN_DOWNLOAD_CHUNK_BYTES = 20
export const MAX_DOWNLOAD_CHUNK_BYTES = 160

export const SAFE_PACKAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/
export const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
