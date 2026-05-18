# BLE Xteink System Design

## Goal

Build a standalone companion for Xteink/Marginalia/CrossPoint BLE transfer.

The first product is a public HTTPS website, suitable for a Vercel deployment such as `ble-xteink.vercel.app`. It should
work for users who have firmware with the BLE transfer protocol and do not want to use a Python CLI.

The repo is a monorepo from the start so the web app, future React Native app, shared UI, and protocol client stay
aligned.

## Scope

Initial scope:

- connect to the reader over Web Bluetooth;
- authenticate with visible code;
- support trusted-host authentication once the browser flow is proven;
- upload approved file kinds;
- download approved diagnostics;
- provide lab pages for compatibility testing;
- keep a shared protocol package for web and mobile clients.

Out of scope for the first browser release:

- arbitrary SD-card browsing;
- arbitrary file reads or writes;
- firmware OTA;
- L2CAP CoC;
- BLE-to-Wi-Fi handoff;
- iOS web support claim;
- cloud accounts or synced trusted-host secrets.

## Monorepo Layout

```text
apps/
  web/       Next.js Web Bluetooth companion.
  mobile/    React Native native BLE companion stub.
packages/
  ble-protocol/ Shared protocol constants and helpers.
  ui/           Shared shadcn UI components.
docs/
  system-design.md
  protocol-contract.md
  compatibility-matrix.md
  release-checklist.md
```

## Architecture

The production website should be static. It does not need server functions to talk to BLE because Web Bluetooth runs in
the user's browser.

The web app owns:

- browser capability detection;
- device picker flow;
- user-facing transfer UI;
- browser local trusted-host storage;
- file picker/download UX;
- transfer progress and error display.

The shared protocol package owns:

- service and characteristic UUIDs;
- command/status type definitions;
- upload/download frame encoding;
- filename and package-id validation;
- trusted-host HMAC helper inputs;
- error normalization.

The mobile app will eventually own:

- native BLE permissions;
- native BLE scanning/connection;
- secure local trusted-host storage where platform APIs allow it;
- the same high-level transfer protocol through `packages/ble-protocol`.

## Why Web First

Web is the easiest way to distribute the companion publicly. Users can open one HTTPS page and connect from a supported
Chromium browser. A native iOS app can come later, but it is a separate project because iOS browsers do not expose Web
Bluetooth.

## Browser Constraints

The web app should assume:

- secure context is required;
- user gesture is required for `requestDevice`;
- Chromium-family browsers are the practical target;
- Safari/iOS are unsupported for web;
- write-without-response chunk limits must be tested on real browsers;
- built-in browser SHA-256 is not streaming.

## Implementation Order

1. Protocol contract.
2. Web Bluetooth lab routes.
3. Compatibility matrix from real hardware.
4. Minimal user-facing transfer UI.
5. Trusted-host storage.
6. Diagnostic downloads.
7. CrossPoint-friendly docs and upstream framing.

Do not start with polished UI. The lab answers the browser behavior questions that decide the correct transfer defaults.
