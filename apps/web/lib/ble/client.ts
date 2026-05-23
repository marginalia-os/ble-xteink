import {
  BLE_TRANSFER_CHARACTERISTICS,
  BLE_TRANSFER_SERVICE_UUID,
  decodeDataFrame,
  decodeStatus,
  encodeDataFrame,
  type ControlCommand,
  type DataFrame,
  type TransferStatus,
} from "@workspace/ble-protocol"

const TRANSFER_DEVICE_NAME_PARTS = [
  "Marginalia Transfer",
  "CrossPoint Transfer",
  "Xteink Transfer",
]

type LabEventType = "info" | "status" | "data-out" | "error"
export type BleWriteMode = "response" | "without-response"

export interface BleLabEvent {
  at: string
  type: LabEventType
  message: string
  detail?: unknown
}

export interface BleTransferSnapshot {
  deviceId: string
  deviceName: string
  serviceUuid: string
  characteristics: Record<
    keyof typeof BLE_TRANSFER_CHARACTERISTICS,
    CharacteristicSnapshot
  >
}

export interface CharacteristicSnapshot {
  uuid: string
  read: boolean
  write: boolean
  writeWithoutResponse: boolean
  notify: boolean
}

export interface BleTransferClientOptions {
  onEvent?: (event: BleLabEvent) => void
  onDataOut?: (frame: DataFrame) => void
  onStatus?: (status: TransferStatus) => void
  onDisconnect?: () => void
}

export class BleTransferBrowserClient {
  private device: BluetoothDevice | undefined
  private statusCharacteristic: BluetoothRemoteGATTCharacteristic | undefined
  private dataOutCharacteristic: BluetoothRemoteGATTCharacteristic | undefined
  private controlCharacteristic: BluetoothRemoteGATTCharacteristic | undefined
  private dataInCharacteristic: BluetoothRemoteGATTCharacteristic | undefined

  constructor(private readonly options: BleTransferClientOptions = {}) {}

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.bluetooth)
  }

  async connect(): Promise<BleTransferSnapshot> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.")
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_TRANSFER_SERVICE_UUID] }],
    })

    return this.connectToDevice(device, "Opening Bluetooth device picker")
  }

  async connectKnown(): Promise<BleTransferSnapshot> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.")
    }
    if (!navigator.bluetooth.getDevices) {
      throw new Error(
        "This browser cannot reconnect to previously allowed Bluetooth devices."
      )
    }

    this.emit("info", "Checking previously allowed Bluetooth devices")
    const devices = await navigator.bluetooth.getDevices()
    const device = devices.find((candidate) =>
      TRANSFER_DEVICE_NAME_PARTS.some((namePart) =>
        candidate.name?.includes(namePart)
      )
    )

    if (!device) {
      throw new Error("No previously allowed BLE transfer device found.")
    }

    return this.connectToDevice(device, "Using previously allowed device")
  }

  private async connectToDevice(
    device: BluetoothDevice,
    sourceMessage: string
  ): Promise<BleTransferSnapshot> {
    this.emit("info", sourceMessage)

    if (!device.gatt) {
      throw new Error("Selected device does not expose a GATT server.")
    }

    this.device = device
    device.addEventListener("gattserverdisconnected", this.handleDisconnect)

    this.emit("info", "Connecting to GATT server", {
      id: device.id,
      name: device.name ?? "Unnamed device",
    })

    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(BLE_TRANSFER_SERVICE_UUID)

    const control = await service.getCharacteristic(
      BLE_TRANSFER_CHARACTERISTICS.control
    )
    const dataIn = await service.getCharacteristic(
      BLE_TRANSFER_CHARACTERISTICS.dataIn
    )
    const status = await service.getCharacteristic(
      BLE_TRANSFER_CHARACTERISTICS.status
    )
    const dataOut = await service.getCharacteristic(
      BLE_TRANSFER_CHARACTERISTICS.dataOut
    )

    this.controlCharacteristic = control
    this.dataInCharacteristic = dataIn
    this.statusCharacteristic = status
    this.dataOutCharacteristic = dataOut

    status.addEventListener(
      "characteristicvaluechanged",
      this.handleStatusChanged
    )
    dataOut.addEventListener(
      "characteristicvaluechanged",
      this.handleDataOutChanged
    )

    const initialStatus = decodeStatus(
      dataViewToArrayBuffer(await status.readValue())
    )
    this.options.onStatus?.(initialStatus)
    this.emit("status", "Read initial status", initialStatus)

    await status.startNotifications()
    this.emit("info", "Subscribed to status notifications")

    if (dataOut.properties.notify) {
      await dataOut.startNotifications()
      this.emit("info", "Subscribed to data-out notifications")
    }

    const snapshot: BleTransferSnapshot = {
      deviceId: device.id,
      deviceName: device.name ?? "Unnamed device",
      serviceUuid: service.uuid,
      characteristics: {
        control: snapshotCharacteristic(control),
        dataIn: snapshotCharacteristic(dataIn),
        status: snapshotCharacteristic(status),
        dataOut: snapshotCharacteristic(dataOut),
      },
    }

    this.emit("info", "Connected", snapshot)
    return snapshot
  }

  async readStatus(): Promise<TransferStatus> {
    if (!this.statusCharacteristic) {
      throw new Error("Status characteristic is not connected.")
    }

    const status = decodeStatus(
      dataViewToArrayBuffer(await this.statusCharacteristic.readValue())
    )
    this.options.onStatus?.(status)
    this.emit("status", "Read status", status)
    return status
  }

  async writeControl(command: ControlCommand): Promise<void> {
    if (!this.controlCharacteristic) {
      throw new Error("Control characteristic is not connected.")
    }

    const payload = new TextEncoder().encode(JSON.stringify(command))
    await this.controlCharacteristic.writeValueWithResponse(payload)
    this.emit("info", `Sent control command: ${command.op}`, command)
  }

  async writeDataFrame(
    sequence: number,
    payload: Uint8Array,
    mode: BleWriteMode
  ): Promise<void> {
    if (!this.dataInCharacteristic) {
      throw new Error("Data-in characteristic is not connected.")
    }

    const frame = encodeDataFrame(sequence, payload)
    if (mode === "without-response") {
      await this.dataInCharacteristic.writeValueWithoutResponse(
        viewToBufferSource(frame)
      )
    } else {
      await this.dataInCharacteristic.writeValueWithResponse(
        viewToBufferSource(frame)
      )
    }
  }

  async disconnect(): Promise<void> {
    if (this.statusCharacteristic) {
      this.statusCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this.handleStatusChanged
      )
      if (this.statusCharacteristic.properties.notify) {
        await ignoreBluetoothError(() =>
          this.statusCharacteristic?.stopNotifications()
        )
      }
    }

    if (this.dataOutCharacteristic) {
      this.dataOutCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this.handleDataOutChanged
      )
      if (this.dataOutCharacteristic.properties.notify) {
        await ignoreBluetoothError(() =>
          this.dataOutCharacteristic?.stopNotifications()
        )
      }
    }

    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.handleDisconnect
    )
    this.device?.gatt?.disconnect()
    this.clearCharacteristics()
    this.emit("info", "Disconnected")
  }

  private readonly handleStatusChanged = (event: Event) => {
    try {
      const value = (event as BluetoothCharacteristicValueChangedEvent).target
        .value
      const status = decodeStatus(dataViewToArrayBuffer(value))
      this.options.onStatus?.(status)
      this.emit("status", "Status notification", status)
    } catch (caught) {
      this.emit(
        "error",
        "Failed to decode status notification",
        errorDetail(caught)
      )
    }
  }

  private readonly handleDataOutChanged = (event: Event) => {
    try {
      const value = (event as BluetoothCharacteristicValueChangedEvent).target
        .value
      const frame = decodeDataFrame(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      )
      this.options.onDataOut?.(frame)
      this.emit("data-out", `Data-out frame ${frame.sequence}`, {
        sequence: frame.sequence,
        payloadBytes: frame.payload.byteLength,
      })
    } catch (caught) {
      this.emit("error", "Failed to decode data-out frame", errorDetail(caught))
    }
  }

  private readonly handleDisconnect = () => {
    this.clearCharacteristics()
    this.options.onDisconnect?.()
    this.emit("info", "Device disconnected")
  }

  private clearCharacteristics(): void {
    this.controlCharacteristic = undefined
    this.dataInCharacteristic = undefined
    this.statusCharacteristic = undefined
    this.dataOutCharacteristic = undefined
  }

  private emit(type: LabEventType, message: string, detail?: unknown): void {
    this.options.onEvent?.({
      at: new Date().toISOString(),
      type,
      message,
      detail,
    })
  }
}

function dataViewToArrayBuffer(value: DataView): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer
}

function viewToBufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer
}

function errorDetail(caught: unknown): { error: string } {
  return {
    error: caught instanceof Error ? caught.message : "Unknown error",
  }
}

function snapshotCharacteristic(
  characteristic: BluetoothRemoteGATTCharacteristic
): CharacteristicSnapshot {
  return {
    uuid: characteristic.uuid,
    read: characteristic.properties.read,
    write: characteristic.properties.write,
    writeWithoutResponse: characteristic.properties.writeWithoutResponse,
    notify: characteristic.properties.notify,
  }
}

async function ignoreBluetoothError(
  callback: () => Promise<unknown> | undefined
): Promise<void> {
  try {
    await callback()
  } catch {
    // Disconnect cleanup should not hide the original connection state.
  }
}
