# Compatibility Matrix

This file tracks real Web Bluetooth behavior for the BLE transfer companion.

Do not claim support for a platform until it has at least one successful hardware test.

| Platform | Browser | Connect | Status Notify | Code Auth | Write Without Response | Data-Out Ordering | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | Chrome | Untested | Untested | Untested | Untested | Untested | First lab target |
| Windows | Chrome or Edge | Untested | Untested | Untested | Untested | Untested | Needed before public recommendation |
| Android | Chrome | Untested | Untested | Untested | Untested | Untested | Important phone target |
| Linux | Chromium | Untested | Untested | Untested | Untested | Untested | Best effort; may require browser flags |
| iOS/iPadOS | Safari/Chrome | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported | Web Bluetooth is not a v1 target |

## Chunk-Size Sweep

Record the largest reliable `data-in` frame size per platform.

Remember that a data frame is:

```text
4-byte sequence header + payload
```

| Platform | Browser | Transfer Mode | Payload Bytes | Frame Bytes | Result | Notes |
| --- | --- | --- | ---: | ---: | --- | --- |
| macOS | Chrome | write without response | 20 | 24 | Untested |  |
| macOS | Chrome | write without response | 160 | 164 | Untested |  |
| macOS | Chrome | write without response | 500 | 504 | Untested |  |

## Required Lab Checks

- Connect through service-filtered `requestDevice`.
- Resolve all four characteristics.
- Read initial status.
- Subscribe to status notifications.
- Send code `hello`.
- Try trusted-host auth after saving a host.
- Upload a small file.
- Upload a larger file with windowed ACKs.
- Download crash report and verify stop-and-go `data-out` ordering.
- Trigger auth failure, disconnect, and reconnect while the reader screen stays open.
