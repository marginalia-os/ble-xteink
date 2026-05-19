# Compatibility Matrix

This file tracks real Web Bluetooth behavior for the BLE transfer companion.

Support is recorded after hardware testing.

| Platform | Browser | Connect | Status Notify | Code Auth | Write Without Response | Data-Out Ordering | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | Helium / Chromium | Works | Works | Works | Works with pacing | Untested | Tested on localhost lab, May 19 2026 |
| Windows | Chrome or Edge | Untested | Untested | Untested | Untested | Untested | Needed before public recommendation |
| Android | Chrome | Untested | Untested | Untested | Untested | Untested | Important phone target |
| Linux | Chromium | Untested | Untested | Untested | Untested | Untested | Best effort; may require browser flags |
| iOS/iPadOS | Safari/Chrome | Unsupported | Unsupported | Unsupported | Unsupported | Unsupported | Web Bluetooth is unavailable |

## Chunk-Size Sweep

Record the largest reliable `data-in` frame size per platform.

Remember that a data frame is:

```text
4-byte sequence header + payload
```

| Platform | Browser | Transfer Mode | Payload Bytes | Frame Bytes | Result | Notes |
| --- | --- | --- | ---: | ---: | --- | --- |
| macOS | Helium / Chromium | response | 20 | 24 | Saved | 12,342-byte BMP, about 640 B/s |
| macOS | Helium / Chromium | response | 160 | 164 | Saved | 12,342-byte BMP, about 4.7 KB/s |
| macOS | Helium / Chromium | response | 244 | 248 | Saved | 12,342-byte BMP, about 5.6 KB/s |
| macOS | Helium / Chromium | response | 500 | 504 | Saved | 12,342-byte BMP, about 10.5 KB/s |
| macOS | Helium / Chromium | write without response | 20 | 24 | Failed | Unpaced upload ended with `size mismatch` |
| macOS | Helium / Chromium | windowed without response | 20 | 24 | Saved | Retested with pacing; observed about 2.7-6.4 KB/s |
| macOS | Helium / Chromium | windowed without response | 160 | 164 | Saved | Retested with pacing; observed about 8.9-10.7 KB/s |
| macOS | Helium / Chromium | windowed without response | 244 | 248 | Saved | Retested with pacing; observed about 7.4-11.1 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Retested with pacing; observed about 8.4-11.0 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 262,902-byte BMP, ACK 160, 1 ms delay, about 6.2 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 1,051,446-byte BMP, ACK 160, 1 ms delay, about 3.3 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 262,902-byte BMP, ACK 8,000, 1 ms delay, about 35.1 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 1,051,446-byte BMP, ACK 8,000, 1 ms delay, observed about 25.7-31.2 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Failed | ACK 32,000, no delay, timed out waiting for first ACK at 32,000 bytes |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 262,902-byte BMP, ACK 8,000, no delay, about 30.1 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 1,051,446-byte BMP, ACK 8,000, no delay, about 38.4 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Failed | ACK 32,000, 1 ms delay, failed with `unexpected data sequence` |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | 262,902-byte BMP, ACK 16,000, no delay, about 39.1 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Auto tune pass: ACK 8,000, no delay, 262,902-byte BMP about 31.1 KB/s; 1,051,446-byte BMP about 18.9 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Auto tune pass: ACK 16,000, no delay, 262,902-byte BMP about 38.5 KB/s; 1,051,446-byte BMP about 41.0 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Auto tune pass: ACK 24,000, no delay, 262,902-byte BMP about 40.9 KB/s; 1,051,446-byte BMP about 40.1 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Repeat auto tune pass: ACK 8,000, no delay, 262,902-byte BMP about 37.8 KB/s; 1,051,446-byte BMP about 36.0 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Repeat auto tune pass: ACK 16,000, no delay, 262,902-byte BMP about 41.5 KB/s; 1,051,446-byte BMP about 35.5 KB/s |
| macOS | Helium / Chromium | windowed without response | 500 | 504 | Saved | Repeat auto tune pass: ACK 24,000, no delay, 262,902-byte BMP about 42.5 KB/s; 1,051,446-byte BMP about 44.9 KB/s |

Current read: ACK 160 is reliable but too conservative for larger uploads because it waits after each 500-byte frame.
ACK 24,000 with no delay is the current browser default on macOS Helium/Chromium.
ACK 8,000 with no delay remains the conservative fallback.
ACK 32,000 is not reliable, with or without a 1 ms delay.
The next browser-lab pass should stop tuning uploads and start validating browser downloads.

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
