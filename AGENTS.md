# AGENTS.md

Guidance for agents working in `ble-xteink`.

## Project Role

This repo is a standalone web and mobile companion for Xteink/Marginalia/CrossPoint BLE transfer.

The first public target is a static HTTPS website, likely deployed to Vercel. The site should let users connect to a
reader over Web Bluetooth and use the existing BLE transfer protocol without installing CLI tooling.

The mobile app is a React Native stub for future native BLE support. Do not treat it as production-ready yet.

## Current Shape

- `apps/web`: Next.js web app created with shadcn monorepo preset.
- `apps/mobile`: React Native app stub for future native BLE client work.
- `packages/ui`: shared shadcn UI package.
- `packages/ble-protocol`: shared protocol constants, validation, framing, and crypto helpers.
- `docs`: system design and compatibility planning.

## Guardrails

- Keep the BLE protocol client separate from UI components.
- Do not add a backend unless there is a clear reason; v1 should be static.
- Do not add analytics or third-party runtime scripts that can observe filenames, package ids, device ids, BLE status,
  trusted-host secrets, or transfer payloads.
- Do not claim Safari/iOS web support.
- Do not expose arbitrary SD-card browsing, arbitrary path reads, or arbitrary path writes.
- Keep firmware OTA out of the first browser UI until Web Bluetooth reliability is proven.
- Prefer CrossPoint/Xteink-friendly naming in shared packages. Marginalia-specific behavior should be layered on top.

## Local Workflow

Use Bun for package management:

```sh
bun install
bun run lint
bun run typecheck
```

Do not run dev servers unless explicitly requested.
