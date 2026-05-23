# BLE Xteink

BLE transfer companion for Xteink readers running compatible firmware.

The project provides a browser client for local BLE file transfer and a React Native workspace for native client work.
The shared protocol package keeps transfer framing, validation, and authentication helpers consistent across clients.

Production web app: https://ble.marginalia-os.lol/

## Workspace

- `apps/web`: browser companion built with Next.js.
- `apps/mobile`: React Native app workspace.
- `packages/ble-protocol`: shared BLE transfer protocol helpers.
- `packages/ui`: shared shadcn UI components.
- `docs`: protocol, compatibility, and release documents.

## Commands

```sh
bun install
bun run lint
bun run typecheck
```

Run the real-device browser transfer check against an already running web app:

```sh
bun run hardware:transfer-check -- --url http://localhost:3000/transfer
```

The script opens visible Chrome, selects the real `Marginalia Transfer` Web Bluetooth device through Chrome CDP, waits for trusted-browser auth, clicks `Transfer check`, and writes `.lab-reports/transfer-check.json`.
Use Chrome CDP for this workflow; WebDriver BiDi can open the Web Bluetooth chooser here, but does not reliably expose selectable device entries.

First run for a fresh automation profile:

```sh
bun run hardware:transfer-check -- --url http://localhost:3000/transfer --code 123456
```

The reader still requires physical confirmation before it saves the browser. After that, reruns should not need the six-digit code:

```sh
bun run hardware:transfer-check -- --url http://localhost:3000/transfer
```

Diagnostics-only hardware pass:

```sh
bun run hardware:transfer-check -- --url http://localhost:3000/transfer --mode diagnostics
```

This downloads the crash report. Add `--package-id <safe-package-id>` to also download package-state diagnostics. The report includes the Chrome version, protocol, selected BLE device, auth path, status, recent event log entries, result rows, and overflow check. Use `--verbose-events` when a failure needs the full UI event log.

## Documentation

- [System design](./docs/system-design.md)
- [Architecture notes](./docs/architecture-notes.md)
- [Trusted host flow](./docs/trusted-host-flow.md)
- [Protocol contract](./docs/protocol-contract.md)
- [Compatibility matrix](./docs/compatibility-matrix.md)
- [Release checklist](./docs/release-checklist.md)
