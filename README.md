# BLE Xteink

Standalone web and mobile companion for Xteink/Marginalia/CrossPoint BLE transfer.

The first public target is a static HTTPS website, suitable for deployment at a domain like `ble-xteink.vercel.app`.
The React Native app is present as a stub for future native BLE support.

## Workspace

- `apps/web`: Next.js Web Bluetooth companion.
- `apps/mobile`: React Native stub.
- `packages/ble-protocol`: shared BLE transfer protocol helpers.
- `packages/ui`: shared shadcn UI components.
- `docs`: protocol, compatibility, and release planning.

## Commands

Use Bun:

```sh
bun install
bun run lint
bun run typecheck
```

Do not start dev servers unless you are actively testing a UI.

## Current Phase

This repo is in prototype setup. The next real milestone is a Web Bluetooth lab that validates connection, status
notifications, authentication, upload chunk sizes, and download frame ordering on real hardware before building polished
UI.
