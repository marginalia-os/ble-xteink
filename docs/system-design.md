# BLE Xteink System Design

## Goal

BLE Xteink provides web and mobile clients for the Xteink BLE transfer protocol.

The web client connects directly from a supported browser over Web Bluetooth. The mobile workspace is for native BLE
clients that use the same protocol utilities.

## Scope

The companion covers approved transfer operations exposed by compatible firmware:

- connect to the reader over Web Bluetooth;
- authenticate with a visible code or a saved trusted-host record;
- upload approved file kinds;
- download approved diagnostics;
- show transfer progress and errors;
- keep protocol utilities reusable across web and mobile clients.

The companion does not expose raw SD-card browsing or arbitrary device paths.

## Monorepo Layout

```text
apps/
  web/       Next.js Web Bluetooth companion.
  mobile/    React Native app workspace.
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

The website can be hosted as static assets. Web Bluetooth runs in the user's browser, so BLE transfers do not require a
backend service.

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

The mobile app workspace owns native-client concerns:

- native BLE permissions;
- native BLE scanning/connection;
- secure local trusted-host storage where platform APIs allow it;
- the same high-level transfer protocol through `packages/ble-protocol`.

## Browser Constraints

The web app relies on Web Bluetooth behavior available in Chromium-family browsers:

- HTTPS is required;
- `requestDevice` requires a user gesture;
- Safari and iOS browsers do not provide Web Bluetooth support;
- write-without-response limits vary by browser and adapter;
- browser SHA-256 APIs are not streaming.

## Roadmap

1. Protocol contract.
2. Web Bluetooth lab routes.
3. Compatibility matrix from real hardware.
4. Minimal user-facing transfer UI.
5. Trusted-host storage.
6. Diagnostic downloads.
7. Public release documentation.
