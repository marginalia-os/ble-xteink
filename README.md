# BLE Xteink

BLE transfer companion for Xteink readers running compatible firmware.

The project provides a browser client for local BLE file transfer and a React Native workspace for native client work.
The shared protocol package keeps transfer framing, validation, and authentication helpers consistent across clients.

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

## Documentation

- [System design](./docs/system-design.md)
- [Protocol contract](./docs/protocol-contract.md)
- [Compatibility matrix](./docs/compatibility-matrix.md)
- [Release checklist](./docs/release-checklist.md)
