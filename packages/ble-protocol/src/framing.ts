import { DATA_FRAME_HEADER_BYTES } from "./constants"

export interface DataFrame {
  sequence: number
  payload: Uint8Array
}

export function encodeDataFrame(
  sequence: number,
  payload: Uint8Array
): Uint8Array {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
    throw new RangeError("sequence must fit uint32")
  }

  const frame = new Uint8Array(DATA_FRAME_HEADER_BYTES + payload.byteLength)
  const view = new DataView(frame.buffer)
  view.setUint32(0, sequence, true)
  frame.set(payload, DATA_FRAME_HEADER_BYTES)
  return frame
}

export function decodeDataFrame(frame: Uint8Array): DataFrame {
  if (frame.byteLength < DATA_FRAME_HEADER_BYTES) {
    throw new RangeError("frame is shorter than the sequence header")
  }

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  return {
    sequence: view.getUint32(0, true),
    payload: frame.slice(DATA_FRAME_HEADER_BYTES),
  }
}
