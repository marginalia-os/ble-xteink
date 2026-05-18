# Release Checklist

Release checks for the public web companion.

## Browser Support

- macOS Chrome tested on hardware.
- Windows Chrome or Edge tested on hardware.
- Android Chrome tested on hardware.
- Unsupported browser message checked in Safari and Firefox.
- HTTPS deployment checked.

## Protocol

- Protocol contract matches firmware.
- UUIDs verified.
- Code authentication tested.
- Trusted-host authentication tested.
- Upload frame sequence tested.
- Download frame sequence and ACK tested.
- Firmware error strings mapped to user-facing messages.

## Security

- No backend service in the transfer path.
- No analytics or third-party runtime scripts.
- Trusted-host secrets stored only on the local browser origin.
- Forget saved reader clears local trusted-host records.
- No arbitrary path input.
- No arbitrary SD-card browsing.
- Browser OTA is hidden unless explicitly enabled after compatibility testing.

## UX

- Transfer screen is usable on desktop and phone viewport.
- Progress remains visible during long transfers.
- Cancel works while connected.
- Browser/tab close warning appears during active transfer.
- Final status shows the filename and destination/kind.

## Deployment

- Static Vercel deployment configured.
- Production domain documented.
- CLI fallback documented.
- Compatibility matrix published.
