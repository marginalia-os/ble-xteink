# BLE Transfer Protocol Contract

This is the browser-facing contract for the Xteink/Marginalia/CrossPoint BLE transfer service.

This document tracks current firmware behavior and the client-visible compatibility contract.

## Service

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

First use uses a visible six-digit code.

Trusted-host authentication uses:

```text
message = "{device_nonce}|{host_id}|1"
response = HMAC-SHA256(secret_utf8, message_utf8).hex()
```

Code `hello`:

```json
{
  "op": "hello",
  "version": 1,
  "code": "123456"
}
```

Trusted-host `hello`:

```json
{
  "op": "hello",
  "version": 1,
  "host_id": "host-id",
  "response": "hex-hmac"
}
```

Legacy pairing request fields can be included with code auth for upload flows:

```json
{
  "pair_host_id": "host-id",
  "pair_host_name": "MacBook",
  "pair_secret": "64-lowercase-hex-characters"
}
```

Browser diagnostic flows should request pairing explicitly after code auth and
before downloads:

```json
{
  "op": "save_host",
  "host_id": "host-id",
  "host_name": "Browser",
  "secret": "64-lowercase-hex-characters"
}
```

The browser waits for `paired: true`, `pairing: "skipped"`, or `error` before
starting diagnostics.

## Upload Command

```json
{
  "op": "start_put",
  "kind": "book",
  "name": "book.epub",
  "size": 12345,
  "sha256": "hex-sha256",
  "resume": false,
  "chunk_size": 160,
  "ack_bytes": 960
}
```

Allowed `kind` values depend on firmware:

- `package`
- `book`
- `bmp`
- `firmware`

Browser clients keep `firmware` hidden until Web Bluetooth transfer reliability is measured on supported platforms.

## Upload Frame

Each `data-in` write is:

```text
uint32_le sequence
uint8[] payload
```

The first sequence is `0` unless resuming. Resume sequence is:

```text
sequence = resume_offset / chunk_size
```

The payload length must be less than or equal to `chunk_size`. For write without response, the entire frame must fit the
browser/adapter write limit. Because Web Bluetooth does not expose a reliable maximum write-without-response size, the
web client must discover safe values through compatibility testing and keep conservative defaults.

## Commit And Cancel

Commit:

```json
{ "op": "commit" }
```

Cancel:

```json
{ "op": "cancel" }
```

## Download Command

Crash report:

```json
{
  "op": "start_get",
  "kind": "crash_report",
  "offset": 0,
  "chunk_size": 160
}
```

Package state:

```json
{
  "op": "start_get",
  "kind": "package_state",
  "package_id": "org.example.package",
  "offset": 0,
  "chunk_size": 160
}
```

Allowed download kinds:

- `crash_report`
- `package_state`

No arbitrary path reads are allowed.

## Download Frame

Each `data-out` notification is:

```text
uint32_le sequence
uint8[] payload
```

The client validates the sequence and then sends:

```json
{
  "op": "get_ack",
  "sequence": 0
}
```

The device sends the next frame only after the ACK.

## Validation Rules

Safe upload filename:

- basename only;
- no `/` or `\`;
- non-empty;
- at most 96 bytes;
- does not start with `.`;
- ASCII letters, ASCII digits, `.`, `_`, and `-` only;
- suffix must match the upload kind.

Package id:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$
```

## Status

The `status` characteristic is UTF-8 JSON.

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
- `ack_bytes`

Known states:

- `advertising`
- `connected`
- `receiving`
- `verifying`
- `confirming`
- `updating`
- `installed`
- `saved`
- `sent`
- `restarting`
- `error`

## Candidate Capability Fields

Compatible firmware can expose:

- `protocol_version`
- `firmware_name`
- `firmware_version`
- `upload_kinds`
- `download_kinds`
- `resume_supported`
- `firmware_ota_supported`
- `max_download_chunk_size`
