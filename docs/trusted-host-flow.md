# Trusted Host Flow

Trusted-host support lets a returning browser authenticate without asking for
the six-digit reader code.

## Data Stored By The Browser

Store trusted-host records in browser-local storage for the current origin only.
Each record is keyed by `device_id` and contains:

- `device_id`
- `host_id`
- `host_name`
- `secret`
- `created_at`
- `last_used_at`

The secret never leaves the browser except as an HMAC response.

## First Pairing

1. Connect and read initial status.
2. User enters the visible six-digit code.
3. Browser creates:
   - random `host_id`
   - display `host_name`
   - random 32-byte hex `secret`
4. Browser sends code auth:

```json
{
  "op": "hello",
  "version": 1,
  "code": "123456"
}
```

5. Browser sends an explicit save-host request:

```json
{
  "op": "save_host",
  "host_id": "host-id",
  "host_name": "Browser",
  "secret": "64-lowercase-hex"
}
```

6. Device prompts the user to save the host.
7. Browser saves the local trusted-host record only after status includes
   `paired: true`.

If the device reports `pairing: "skipped"` or `error`, the browser discards the
generated secret.

## Returning Authentication

1. Connect and read initial status.
2. If `device_id` has a local trusted-host record, compute:

```text
message = "{device_nonce}|{host_id}|1"
response = HMAC-SHA256(secret_utf8, message_utf8).hex()
```

3. Browser sends:

```json
{
  "op": "hello",
  "version": 1,
  "host_id": "host-id",
  "response": "hex-hmac"
}
```

4. If trusted auth fails, forget only the failed attempt state and show the code
   flow. Do not delete the saved record automatically; the device may have
   rotated nonce/state or the browser may be talking to the wrong reader.

## UI Needed

- `Save this browser` checkbox next to code auth.
- `Use saved browser` action when a matching local record exists.
- `Forget this reader` action.
- Copyable auth error/status details in lab pages.

## Implementation Order

1. Add storage helpers in the web app.
2. Add shared random host/secret helpers in `packages/ble-protocol`.
3. Add trusted auth controls to `/lab/connect`.
4. Add trusted auth controls to `/lab/upload-sweep`.
5. Use the same flow in the public transfer screen.
