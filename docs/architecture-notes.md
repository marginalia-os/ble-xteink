# Architecture Notes

## Effect

The project does not use Effect today.

Effect becomes worth another look when the client has several long-running BLE
workflows with shared cancellation, retries, resumable state, typed failures,
trusted-host storage, and platform-specific implementations. That likely means
package upload, diagnostic download, and trusted-host pairing are all present in
both web and native clients.

Until then, the BLE browser client stays as a small imperative adapter around
Web Bluetooth. Keeping it direct makes hardware behavior easier to debug.
