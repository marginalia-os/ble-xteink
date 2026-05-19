"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  BluetoothIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SendIcon,
  UnplugIcon,
} from "lucide-react"

import {
  BleTransferBrowserClient,
  type BleLabEvent,
  type BleTransferSnapshot,
} from "@/lib/ble/client"
import { CopyButton } from "@/app/lab/components/copy-button"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@workspace/ui/components/table"
import type { TransferStatus } from "@workspace/ble-protocol"

type ConnectionState = "idle" | "connecting" | "connected" | "error"

export function ConnectLab() {
  const clientRef = useRef<BleTransferBrowserClient | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle")
  const [snapshot, setSnapshot] = useState<BleTransferSnapshot | null>(null)
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const [events, setEvents] = useState<BleLabEvent[]>([])
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const isSupported = useBrowserBluetoothSupport()

  const isBusy = connectionState === "connecting"
  const isConnected = connectionState === "connected"

  async function connect() {
    setError(null)
    setConnectionState("connecting")
    setEvents([])
    setStatus(null)
    setSnapshot(null)

    const client = new BleTransferBrowserClient({
      onEvent: appendEvent,
      onStatus: setStatus,
      onDisconnect: () => {
        setConnectionState("idle")
        setSnapshot(null)
      },
    })

    clientRef.current = client

    try {
      const connectedSnapshot = await client.connect()
      setSnapshot(connectedSnapshot)
      setConnectionState("connected")
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Connection failed."
      setError(message)
      setConnectionState("error")
      appendEvent({
        at: new Date().toISOString(),
        type: "error",
        message,
      })
    }
  }

  async function disconnect() {
    setError(null)
    await clientRef.current?.disconnect()
    clientRef.current = null
    setConnectionState("idle")
    setSnapshot(null)
  }

  async function readStatus() {
    setError(null)
    try {
      await clientRef.current?.readStatus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status read failed.")
    }
  }

  async function sendHello() {
    setError(null)

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code shown on the reader.")
      return
    }

    try {
      await clientRef.current?.writeControl({
        op: "hello",
        version: 1,
        code,
      })
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Hello command failed."
      )
    }
  }

  function appendEvent(event: BleLabEvent) {
    setEvents((current) => [event, ...current].slice(0, 80))
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 px-5 py-6 text-sm sm:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-medium">BLE connect lab</h1>
          <Badge variant={isSupported ? "secondary" : "destructive"}>
            {isSupported
              ? "Web Bluetooth available"
              : "Web Bluetooth unavailable"}
          </Badge>
          <Badge variant={isConnected ? "default" : "outline"}>
            {connectionState}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Connect to the reader transfer service, inspect GATT characteristics,
          read status, and watch notifications.
        </p>
      </header>

      <section className="flex flex-col gap-4 border-y py-5">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={connect}
            disabled={!isSupported || isBusy || isConnected}
          >
            <BluetoothIcon data-icon="inline-start" />
            Connect
          </Button>
          <Button
            variant="outline"
            onClick={readStatus}
            disabled={!isConnected}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Read status
          </Button>
          <Button
            variant="outline"
            onClick={disconnect}
            disabled={!isConnected && !isBusy}
          >
            <UnplugIcon data-icon="inline-start" />
            Disconnect
          </Button>
        </div>

        <FieldGroup className="max-w-sm gap-4">
          <Field>
            <FieldLabel htmlFor="transfer-code">Visible code</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="transfer-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Visible code"
                className="font-mono"
                placeholder="123456"
              />
              <Button
                variant="secondary"
                onClick={sendHello}
                disabled={!isConnected}
              >
                <SendIcon data-icon="inline-start" />
                Hello
              </Button>
            </div>
            <FieldDescription>
              Sends the current pairing code to validate the control
              characteristic.
            </FieldDescription>
          </Field>
        </FieldGroup>

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Action blocked</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Connection</h2>
            <CopyButton
              label="Copy connection"
              value={snapshot ? toDebugJson(snapshot) : ""}
              disabled={!snapshot}
            />
          </div>
          {snapshot ? (
            <div className="rounded-md border">
              <Table className="min-w-[36rem] text-xs">
                <TableBody>
                  <InfoRow
                    label="Device"
                    value={`${snapshot.deviceName} (${snapshot.deviceId})`}
                  />
                  <InfoRow label="Service" value={snapshot.serviceUuid} />
                  {Object.entries(snapshot.characteristics).map(
                    ([name, characteristic]) => (
                      <InfoRow
                        key={name}
                        label={name}
                        value={`${characteristic.uuid} | read=${String(characteristic.read)} write=${String(
                          characteristic.write
                        )} writeWithoutResponse=${String(characteristic.writeWithoutResponse)} notify=${String(
                          characteristic.notify
                        )}`}
                      />
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground">No device connected.</p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Latest status</h2>
            <CopyButton
              label="Copy status"
              value={status ? toDebugJson(status) : ""}
              disabled={!status}
            />
          </div>
          <pre className="min-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {status ? JSON.stringify(status, null, 2) : "No status yet."}
          </pre>
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlugZapIcon aria-hidden />
            <h2 className="font-medium">Event log</h2>
          </div>
          <CopyButton
            label="Copy log"
            value={toDebugJson(events)}
            disabled={events.length === 0}
          />
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-md border">
          {events.length > 0 ? (
            <ol className="divide-y">
              {events.map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  className="flex flex-col gap-1 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        event.type === "error" ? "destructive" : "outline"
                      }
                    >
                      {event.type}
                    </Badge>
                    <span className="font-medium">{event.message}</span>
                    <time className="font-mono text-xs text-muted-foreground">
                      {formatTime(event.at)}
                    </time>
                    <CopyButton
                      label="Copy event"
                      value={toDebugJson(event)}
                      size="xs"
                    />
                  </div>
                  {event.detail ? (
                    <pre className="overflow-auto font-mono text-xs text-muted-foreground">
                      {JSON.stringify(event.detail, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-3 text-muted-foreground">No events yet.</p>
          )}
        </div>
      </section>
    </main>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-36 bg-muted/40 align-top font-medium">
        {label}
      </TableCell>
      <TableCell className="font-mono text-muted-foreground">{value}</TableCell>
    </TableRow>
  )
}

function useBrowserBluetoothSupport(): boolean {
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    setIsSupported(BleTransferBrowserClient.isSupported())
  }, [])

  return isSupported
}

function toDebugJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}
