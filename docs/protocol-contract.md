# BLE Transfer Protocol Compatibility

This document is the shared compatibility contract for the Marginalia BLE transfer service and the browser companion at
<https://ble.marginalia-os.lol/>.

## Compatibility Version

- Protocol version: `1`
- GATT service name: `Marginalia Transfer`
- Browser companion: `https://ble.marginalia-os.lol/`
- First browser scope: package, book, BMP, crash-report, and package-state transfers
- Firmware OTA scope: command-line client only until browser transfer reliability is proven for large firmware images

The firmware does not yet publish a `protocol_version` field in status JSON. Clients should send `hello.version = 1`
and feature-detect newer behavior from accepted operations and explicit `error` states.

## GATT Service

Service UUID:

```text
6f9f0a00-9b1d-4d1f-9f53-5b6b8b3d0f10
```

Characteristics:

| Name | UUID | Direction | Properties |
| --- | --- | --- | --- |
| `control` | `6f9f0a01-9b1d-4d1f-9f53-5b6b8b3d0f10` | client to device | write with response |
| `data-in` | `6f9f0a02-9b1d-4d1f-9f53-5b6b8b3d0f10` | client to device | write, write without response |
| `status` | `6f9f0a03-9b1d-4d1f-9f53-5b6b8b3d0f10` | device to client | read, notify |
| `data-out` | `6f9f0a04-9b1d-4d1f-9f53-5b6b8b3d0f10` | device to client | notify |

## Authentication

First use uses the six-digit code shown on the Bluetooth Transfer screen:

```json
{
  "op": "hello",
  "version": 1,
  "code": "123456"
}
```

Trusted-host authentication uses the device nonce from status JSON:

```text
message = "{device_nonce}|{host_id}|1"
response = HMAC-SHA256(secret_utf8, message_utf8).hex()
```

```json
{
  "op": "hello",
  "version": 1,
  "host_id": "host-id",
  "response": "hex-hmac"
}
```

After code authentication, clients can request a saved host:

```json
{
  "op": "save_host",
  "host_id": "host-id",
  "host_name": "Browser",
  "secret": "64-lowercase-hex-characters"
}
```

The client should wait for `paired: true`, `pairing: "skipped"`, or `state: "error"` before starting a transfer that
depends on trusted-host persistence.

## Control Operations

Supported control `op` names:

- `hello`
- `save_host`
- `start_put`
- `commit`
- `cancel`
- `start_get`
- `get_ack`

`start_put` fields:

```json
{
  "op": "start_put",
  "kind": "book",
  "name": "book.epub",
  "size": 12345,
  "sha256": "hex-sha256",
  "resume": false,
  "chunk_size": 160,
  "ack_bytes": 24000
}
```

Supported upload `kind` values:

- `package`
- `book`
- `bmp`
- `firmware`

The public browser companion exposes `package`, `book`, and `bmp`. `firmware` stays CLI-only for now.

`start_get` fields:

```json
{
  "op": "start_get",
  "kind": "crash_report",
  "offset": 0,
  "chunk_size": 160
}
```

Supported download `kind` values:

- `crash_report`
- `package_state`

`package_state` also requires a safe `package_id`.

## Binary Frames

Uploads write frames to `data-in`:

```text
uint32_le sequence
uint8[] payload
```

Downloads notify frames on `data-out` with the same layout. After each download frame, the client validates the sequence
and sends:

```json
{
  "op": "get_ack",
  "sequence": 0
}
```

Resume sequence numbers are derived from the byte offset and original chunk size:

```text
sequence = floor(offset / chunk_size)
```

For resumed transfers, `offset` must be exactly divisible by `chunk_size`. Firmware rejects partial offsets that would
split a protocol frame.

Download chunk size is currently limited to `20..160` bytes. Upload frames may be larger when the central and adapter
accept them; browser clients should keep conservative defaults and use status progress as receiver flow control.

## Status

The `status` characteristic is UTF-8 JSON.

Known states:

- `starting`
- `advertising`
- `connected`
- `receiving`
- `verifying`
- `installing`
- `installed`
- `saved`
- `confirming`
- `updating`
- `restarting`
- `sending`
- `sent`
- `save_host_prompt`
- `forget_host_prompt`
- `error`

Known fields:

- `state`
- `device_id`
- `device_nonce`
- `has_trusted_host`
- `trusted_host`
- `received`
- `sent`
- `written`
- `size`
- `path`
- `name`
- `package`
- `error`
- `paired`
- `pairing`
- `resumable`
- `ack_bytes`

## Validation Rules

Safe upload filenames:

- basename only;
- no `/` or `\`;
- non-empty;
- at most 96 bytes;
- not dot-prefixed;
- ASCII letters, ASCII digits, `.`, `_`, and `-` only;
- suffix must match the upload kind.

Upload suffixes:

- `package`: `.mpkg.zip`
- `book`: `.epub`
- `bmp`: `.bmp`
- `firmware`: `.bin`

Safe package id:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$
```

Allowed read destinations:

- `/crash_report.txt`
- `/.marginalia/package-state/<safe-package-id>.json`

No arbitrary SD-card browsing, arbitrary path reads, or arbitrary path writes are part of this protocol.

## Future Capability Fields

Compatible firmware can later expose:

- `protocol_version`
- `firmware_name`
- `firmware_version`
- `upload_kinds`
- `download_kinds`
- `resume_supported`
- `firmware_ota_supported`
- `max_download_chunk_size`
