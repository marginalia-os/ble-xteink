"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  BluetoothIcon,
  CheckCircle2Icon,
  DownloadIcon,
  RefreshCwIcon,
  SendIcon,
  UnplugIcon,
} from "lucide-react"

import { CopyButton } from "@/app/components/copy-button"
import { BleTransferBrowserClient, type BleLabEvent } from "@/lib/ble/client"
import {
  createPairingHello,
  createTrustedHello,
  forgetTrustedHost,
  getTrustedHost,
  rememberTrustedHost,
  type PendingTrustedHost,
} from "@/lib/ble/trusted-hosts"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  DEFAULT_DOWNLOAD_CHUNK_BYTES,
  isSafePackageId,
  type DataFrame,
  type DownloadKind,
  type StartGetCommand,
  type TransferStatus,
} from "@workspace/ble-protocol"

type ConnectionState = "idle" | "connecting" | "connected" | "error"
type DownloadState = "idle" | "running" | "done" | "error"

interface DownloadResult {
  kind: DownloadKind
  packageId?: string
  chunkSize: number
  frameCount: number
  receivedBytes: number
  expectedBytes?: number
  durationMs: number
  bytesPerSecond: number
  finalState?: string
  preview: string
  error?: string
}

interface ActiveDownload {
  chunks: Uint8Array[]
  client: BleTransferBrowserClient
  error?: string
  expectedSequence: number
  frameCount: number
  receivedBytes: number
}

interface DownloadOptions {
  copyResult?: boolean
}

interface AuthTraceEntry {
  at: string
  step: string
  detail?: unknown
}

export function DownloadLab() {
  const clientRef = useRef<BleTransferBrowserClient | null>(null)
  const statusRef = useRef<TransferStatus | null>(null)
  const statusVersionRef = useRef(0)
  const activeDownloadRef = useRef<ActiveDownload | null>(null)
  const pendingTrustedHostRef = useRef<PendingTrustedHost | null>(null)
  const authTraceRef = useRef<AuthTraceEntry[]>([])
  const autoStartedRef = useRef(false)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle")
  const [downloadState, setDownloadState] = useState<DownloadState>("idle")
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const [events, setEvents] = useState<BleLabEvent[]>([])
  const [results, setResults] = useState<DownloadResult[]>([])
  const [authTrace, setAuthTrace] = useState<AuthTraceEntry[]>([])
  const [code, setCode] = useState("")
  const [packageId, setPackageId] = useState("")
  const [chunkSize, setChunkSize] = useState(
    String(DEFAULT_DOWNLOAD_CHUNK_BYTES)
  )
  const [trustedHostMessage, setTrustedHostMessage] = useState<string | null>(
    null
  )
  const [autoCopyMessage, setAutoCopyMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isSupported = useBrowserBluetoothSupport()

  const isBusy = connectionState === "connecting"
  const isConnected = connectionState === "connected"
  const isRunning = downloadState === "running"

  async function connect() {
    setError(null)
    setConnectionState("connecting")
    setEvents([])
    setStatus(null)
    autoStartedRef.current = false

    const client = new BleTransferBrowserClient({
      onDataOut: handleDataOut,
      onEvent: appendEvent,
      onStatus: updateStatus,
      onDisconnect: () => {
        activeDownloadRef.current = null
        setConnectionState("idle")
      },
    })

    clientRef.current = client

    try {
      await client.connect()
      setConnectionState("connected")
      const didTrust = await tryTrustedAuth(client)
      if (didTrust) await runDiagnosticsPass()
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
    activeDownloadRef.current = null
    await clientRef.current?.disconnect()
    clientRef.current = null
    setConnectionState("idle")
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
      const client = clientRef.current
      const currentStatus = statusRef.current ?? (await client?.readStatus())
      traceAuth("code status", {
        device_id: currentStatus?.device_id,
        has_trusted_host: currentStatus?.has_trusted_host,
      })
      const pairing = currentStatus
        ? createPairingHello(currentStatus, code)
        : null
      if (!pairing) {
        throw new Error("Could not create trusted-host pairing payload.")
      }
      pendingTrustedHostRef.current = pairing
      const helloStatusVersion = statusVersionRef.current
      traceAuth("code hello")
      await client?.writeControl(pairing.command)
      const helloStatus = await waitForStatus(
        (candidate) =>
          candidate.state === "connected" || candidate.state === "error",
        8_000,
        helloStatusVersion
      )
      if (helloStatus?.state === "error") {
        throw new Error(helloStatus.error ?? "Hello command failed.")
      }
      if (!client) throw new Error("Bluetooth client is not connected.")
      const saveHostStatusVersion = statusVersionRef.current
      traceAuth("save host requested", {
        host_id: pairing.record.hostId,
        device_id: pairing.record.deviceId,
      })
      await client.writeControl(pairing.saveCommand)
      setTrustedHostMessage("Waiting for reader save-browser confirmation.")
      const saveHostStatus = await waitForStatus(
        (candidate) =>
          Boolean(candidate.paired) ||
          candidate.pairing === "skipped" ||
          candidate.state === "error",
        30_000,
        saveHostStatusVersion
      )
      if (!saveHostStatus) {
        throw new Error(
          "Timed out waiting for reader save-browser confirmation."
        )
      }
      if (saveHostStatus.state === "error") {
        throw new Error(saveHostStatus.error ?? "Save-browser request failed.")
      }
      if (saveHostStatus.pairing === "skipped") {
        throw new Error("Reader skipped save-browser pairing.")
      }
      traceAuth("save host accepted", {
        paired: saveHostStatus.paired,
        has_trusted_host: saveHostStatus.has_trusted_host,
      })
      await postReport("download-auth", {
        result: "code-paired",
        trace: getAuthTraceSnapshot(),
      })
      await runDiagnosticsPass()
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Hello command failed."
      traceAuth("code flow failed", { error: message })
      await postReport("download-auth", {
        result: "code-failed",
        error: message,
        trace: getAuthTraceSnapshot(),
      })
      setError(message)
    }
  }

  async function tryTrustedAuth(client: BleTransferBrowserClient) {
    const nextStatus = await client.readStatus()
    const savedHost = getTrustedHost(nextStatus.device_id)
    traceAuth("connect status", {
      device_id: nextStatus.device_id,
      has_trusted_host: nextStatus.has_trusted_host,
      browser_has_saved_host: Boolean(savedHost),
      has_nonce: Boolean(nextStatus.device_nonce),
    })
    const command = await createTrustedHello(nextStatus)
    if (!command) {
      if (savedHost) {
        setTrustedHostMessage(
          "Saved browser found, but device nonce is missing."
        )
        traceAuth("trusted auth unavailable", { reason: "missing nonce" })
      } else {
        traceAuth("trusted auth unavailable", { reason: "no saved browser" })
      }
      return false
    }

    const authStatusVersion = statusVersionRef.current
    traceAuth("trusted hello", { host_id: command.host_id })
    await client.writeControl(command)
    const authStatus = await waitForStatus(
      (candidate) =>
        candidate.state === "connected" ||
        candidate.state === "error" ||
        Boolean(candidate.trusted_host),
      8_000,
      authStatusVersion
    )

    if (authStatus?.trusted_host) {
      setTrustedHostMessage(`Trusted auth: ${authStatus.trusted_host}`)
      traceAuth("trusted auth accepted", {
        trusted_host: authStatus.trusted_host,
      })
      await postReport("download-auth", {
        result: "trusted",
        trace: getAuthTraceSnapshot(),
      })
      return true
    }

    setTrustedHostMessage("Saved browser was not accepted; use the code once.")
    traceAuth("trusted auth rejected", {
      state: authStatus?.state,
      error: authStatus?.error,
    })
    await postReport("download-auth", {
      result: "trusted-rejected",
      status: authStatus,
      trace: getAuthTraceSnapshot(),
    })
    return false
  }

  function forgetCurrentTrustedHost() {
    forgetTrustedHost(statusRef.current?.device_id)
    pendingTrustedHostRef.current = null
    setTrustedHostMessage("Forgot saved browser for this reader.")
  }

  async function runCrashReportDownload() {
    await runDownload({ kind: "crash_report" })
  }

  async function runPackageStateDownload() {
    if (!isSafePackageId(packageId)) {
      setError("Enter a valid package id.")
      return
    }
    await runDownload({ kind: "package_state", packageId })
  }

  async function runDiagnosticsPass() {
    if (autoStartedRef.current && isRunning) return
    autoStartedRef.current = true
    setError(null)
    setResults([])
    setAutoCopyMessage(null)

    const collected: DownloadResult[] = []
    const crashReport = await runDownload(
      { kind: "crash_report" },
      { copyResult: false }
    )
    if (crashReport) collected.push(crashReport)
    if (crashReport?.error) {
      await copyResults(collected)
      return
    }

    if (isSafePackageId(packageId)) {
      const packageState = await runDownload(
        { kind: "package_state", packageId },
        { copyResult: false }
      )
      if (packageState) collected.push(packageState)
    }

    await copyResults(collected)
    await postReport("download-diagnostics", collected)
  }

  async function runDownload(
    {
      kind,
      packageId,
    }: {
      kind: DownloadKind
      packageId?: string
    },
    options: DownloadOptions = {}
  ): Promise<DownloadResult | null> {
    const client = clientRef.current
    if (!client) return null

    const parsedChunkSize = Number.parseInt(chunkSize, 10)
    if (
      !Number.isInteger(parsedChunkSize) ||
      parsedChunkSize < 20 ||
      parsedChunkSize > DEFAULT_DOWNLOAD_CHUNK_BYTES
    ) {
      setError("Download chunk size must be between 20 and 160.")
      return null
    }

    const active: ActiveDownload = {
      chunks: [],
      client,
      expectedSequence: 0,
      frameCount: 0,
      receivedBytes: 0,
    }
    activeDownloadRef.current = active

    setAutoCopyMessage(null)
    setDownloadState("running")
    setError(null)
    const startedAt = nowMs()

    const command: StartGetCommand = {
      op: "start_get",
      kind,
      chunk_size: parsedChunkSize,
    }
    if (packageId) command.package_id = packageId

    try {
      const startStatusVersion = statusVersionRef.current
      await client.writeControl(command)
      const startStatus = await waitForDownloadStart(startStatusVersion)
      if (!startStatus) throw new Error("Timed out waiting for download start.")
      if (startStatus.state === "error") {
        throw new Error(startStatus.error ?? "Device rejected download.")
      }

      const finalStatus = await waitForDownloadEnd(active, 60_000)
      if (active.error) throw new Error(active.error)
      if (!finalStatus) throw new Error("Timed out waiting for download end.")
      if (finalStatus.state === "error") {
        throw new Error(finalStatus.error ?? "Device reported an error.")
      }
      if (finalStatus.state !== "sent") {
        throw new Error(`Unexpected final state: ${finalStatus.state}`)
      }

      const expectedBytes =
        typeof finalStatus.size === "number" ? finalStatus.size : undefined
      if (
        typeof expectedBytes === "number" &&
        active.receivedBytes !== expectedBytes
      ) {
        throw new Error(
          `Received ${active.receivedBytes} bytes, expected ${expectedBytes}.`
        )
      }

      const bytes = concatChunks(active.chunks, active.receivedBytes)
      const durationMs = nowMs() - startedAt
      const result: DownloadResult = {
        kind,
        packageId,
        chunkSize: parsedChunkSize,
        frameCount: active.frameCount,
        receivedBytes: active.receivedBytes,
        expectedBytes,
        durationMs,
        bytesPerSecond: Math.round((active.receivedBytes / durationMs) * 1000),
        finalState: finalStatus.state,
        preview: decodePreview(bytes),
      }
      setResults((current) => [result, ...current])
      setDownloadState("done")
      await postReport("download", result)
      if (options.copyResult !== false) {
        await copyResult(result)
      }
      return result
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Download failed."
      const durationMs = nowMs() - startedAt
      const result: DownloadResult = {
        kind,
        packageId,
        chunkSize: parsedChunkSize,
        frameCount: active.frameCount,
        receivedBytes: active.receivedBytes,
        durationMs,
        bytesPerSecond: 0,
        finalState: statusRef.current?.state,
        preview: "",
        error: message,
      }
      setResults((current) => [result, ...current])
      setDownloadState("error")
      setError(message)
      await client.writeControl({ op: "cancel" }).catch(() => undefined)
      await postReport("download", result)
      if (options.copyResult !== false) {
        await copyResult(result)
      }
      return result
    } finally {
      activeDownloadRef.current = null
    }
  }

  function handleDataOut(frame: DataFrame) {
    const active = activeDownloadRef.current
    if (!active) return

    if (frame.sequence !== active.expectedSequence) {
      active.error = `Unexpected data sequence: got ${frame.sequence}, expected ${active.expectedSequence}.`
      return
    }

    active.chunks.push(frame.payload)
    active.receivedBytes += frame.payload.byteLength
    active.frameCount += 1
    active.expectedSequence += 1

    active.client
      .writeControl({ op: "get_ack", sequence: frame.sequence })
      .catch((caught) => {
        active.error =
          caught instanceof Error ? caught.message : "Failed to ACK frame."
      })
  }

  function updateStatus(nextStatus: TransferStatus) {
    statusVersionRef.current += 1
    statusRef.current = nextStatus
    setStatus(nextStatus)

    const pending = pendingTrustedHostRef.current
    if (pending && nextStatus.paired) {
      rememberTrustedHost(pending.record)
      pendingTrustedHostRef.current = null
      setTrustedHostMessage("Saved this browser for trusted auth.")
    } else if (pending && nextStatus.pairing === "skipped") {
      pendingTrustedHostRef.current = null
      setTrustedHostMessage("Reader skipped trusted-host pairing.")
    }
  }

  function appendEvent(event: BleLabEvent) {
    setEvents((current) => [event, ...current].slice(0, 120))
  }

  function traceAuth(step: string, detail?: unknown) {
    const next = [
      { at: new Date().toISOString(), step, detail },
      ...authTraceRef.current,
    ].slice(0, 80)
    authTraceRef.current = next
    setAuthTrace(next)
  }

  function getAuthTraceSnapshot(): AuthTraceEntry[] {
    return authTraceRef.current
  }

  function waitForDownloadStart(
    afterVersion: number
  ): Promise<TransferStatus | null> {
    return waitForStatus(
      (candidate) =>
        candidate.state === "sending" ||
        candidate.state === "sent" ||
        candidate.state === "error",
      8_000,
      afterVersion
    )
  }

  function waitForDownloadEnd(
    active: ActiveDownload,
    timeoutMs: number
  ): Promise<TransferStatus | null> {
    return new Promise((resolve) => {
      const startedAt = nowMs()
      const timer = window.setInterval(() => {
        if (active.error) {
          window.clearInterval(timer)
          resolve(statusRef.current)
          return
        }

        const candidate = statusRef.current
        if (
          candidate &&
          (candidate.state === "sent" || candidate.state === "error")
        ) {
          window.clearInterval(timer)
          resolve(candidate)
          return
        }

        if (nowMs() - startedAt >= timeoutMs) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 50)
    })
  }

  function waitForStatus(
    predicate: (candidate: TransferStatus) => boolean,
    timeoutMs: number,
    afterVersion = -1
  ): Promise<TransferStatus | null> {
    const current = statusRef.current
    if (
      statusVersionRef.current > afterVersion &&
      current &&
      predicate(current)
    ) {
      return Promise.resolve(current)
    }

    return new Promise((resolve) => {
      const startedAt = nowMs()
      const timer = window.setInterval(() => {
        const candidate = statusRef.current
        if (
          statusVersionRef.current > afterVersion &&
          candidate &&
          predicate(candidate)
        ) {
          window.clearInterval(timer)
          resolve(candidate)
          return
        }
        if (nowMs() - startedAt >= timeoutMs) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 50)
    })
  }

  async function copyResult(result: DownloadResult) {
    try {
      await navigator.clipboard.writeText(toDebugJson(result))
      setAutoCopyMessage("Copied download result.")
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Clipboard write failed."
      setAutoCopyMessage(`Download finished, but copy failed: ${message}`)
    }
  }

  async function copyResults(value: DownloadResult[]) {
    if (value.length === 0) return

    try {
      await navigator.clipboard.writeText(toDebugJson(value))
      setAutoCopyMessage(`Copied ${value.length} download results.`)
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Clipboard write failed."
      setAutoCopyMessage(`Download pass finished, but copy failed: ${message}`)
    }
  }

  async function postReport(source: string, value: unknown) {
    try {
      const response = await fetch("/api/lab-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, value }),
      })
      if (!response.ok) {
        throw new Error(`Report route returned ${response.status}.`)
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Report write failed."
      setAutoCopyMessage(`Local report failed: ${message}`)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 px-5 py-6 text-sm sm:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-medium">
            BLE download lab
          </h1>
          <Badge variant={isSupported ? "secondary" : "destructive"}>
            {isSupported
              ? "Web Bluetooth available"
              : "Web Bluetooth unavailable"}
          </Badge>
          <Badge variant={isConnected ? "default" : "outline"}>
            {connectionState}
          </Badge>
          <Badge variant={isRunning ? "secondary" : "outline"}>
            {downloadState}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Download allowlisted diagnostics and validate data-out notification
          ordering before building the public transfer screen.
        </p>
      </header>

      <section className="flex flex-col gap-4 border-y py-5">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={connect}
            disabled={!isSupported || isBusy || isConnected || isRunning}
          >
            <BluetoothIcon data-icon="inline-start" />
            Connect
          </Button>
          <Button
            variant="outline"
            onClick={readStatus}
            disabled={!isConnected || isRunning}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Read status
          </Button>
          <Button
            variant="outline"
            onClick={disconnect}
            disabled={isRunning || (!isConnected && !isBusy)}
          >
            <UnplugIcon data-icon="inline-start" />
            Disconnect
          </Button>
        </div>

        <FieldGroup className="gap-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <Field>
              <FieldLabel htmlFor="download-visible-code">
                Visible code
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="download-visible-code"
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
                  disabled={!isConnected || isRunning}
                >
                  <SendIcon data-icon="inline-start" />
                  Hello
                </Button>
              </div>
              <FieldDescription>
                Only needed when trusted auth is not available.
              </FieldDescription>
            </Field>

            <Field
              data-invalid={Boolean(packageId && !isSafePackageId(packageId))}
            >
              <FieldLabel htmlFor="download-package-id">Package id</FieldLabel>
              <Input
                id="download-package-id"
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
                aria-label="Package id"
                aria-invalid={Boolean(packageId && !isSafePackageId(packageId))}
                className="font-mono"
                placeholder="org.example.package"
              />
              {packageId && !isSafePackageId(packageId) ? (
                <FieldError>
                  Use 2-96 letters, numbers, dots, underscores, or dashes. Start
                  with a letter or number.
                </FieldError>
              ) : (
                <FieldDescription>
                  Required only for package-state download.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="download-chunk-size">Chunk size</FieldLabel>
              <Input
                id="download-chunk-size"
                value={chunkSize}
                onChange={(event) =>
                  setChunkSize(event.target.value.replace(/\D/g, ""))
                }
                inputMode="numeric"
                aria-label="Download chunk size"
                className="font-mono"
              />
              <FieldDescription>
                Browser lab default is {DEFAULT_DOWNLOAD_CHUNK_BYTES} bytes.
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={runDiagnosticsPass}
            disabled={!isConnected || isRunning}
          >
            <DownloadIcon data-icon="inline-start" />
            Diagnostics pass
          </Button>
          <Button
            variant="outline"
            onClick={runCrashReportDownload}
            disabled={!isConnected || isRunning}
          >
            <DownloadIcon data-icon="inline-start" />
            Get crash report
          </Button>
          <Button
            variant="outline"
            onClick={runPackageStateDownload}
            disabled={!isConnected || isRunning}
          >
            <DownloadIcon data-icon="inline-start" />
            Get package state
          </Button>
          <CopyButton
            label="Copy results"
            value={toDebugJson(results)}
            disabled={results.length === 0}
          />
          <CopyButton
            label="Copy status"
            value={status ? toDebugJson(status) : ""}
            disabled={!status}
          />
          <Button
            variant="outline"
            onClick={forgetCurrentTrustedHost}
            disabled={!status?.device_id || isRunning}
          >
            Forget saved browser
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Action blocked</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {trustedHostMessage ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Auth</AlertTitle>
            <AlertDescription>{trustedHostMessage}</AlertDescription>
          </Alert>
        ) : null}
        {autoCopyMessage ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Clipboard</AlertTitle>
            <AlertDescription>{autoCopyMessage}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Results</h2>
            <CopyButton
              label="Copy results"
              value={toDebugJson(results)}
              disabled={results.length === 0}
            />
          </div>
          <div className="rounded-md border">
            <Table className="min-w-[48rem] text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Chunk</TableHead>
                  <TableHead>Frames</TableHead>
                  <TableHead>Bytes</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length > 0 ? (
                  results.map((result, index) => (
                    <TableRow key={`${result.kind}-${index}`}>
                      <TableCell>
                        {result.packageId
                          ? `${result.kind}:${result.packageId}`
                          : result.kind}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.chunkSize}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.frameCount}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.receivedBytes}
                        {typeof result.expectedBytes === "number"
                          ? ` / ${result.expectedBytes}`
                          : ""}
                      </TableCell>
                      <TableCell className="font-mono">
                        {Math.round(result.durationMs)} ms
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.bytesPerSecond} B/s
                      </TableCell>
                      <TableCell>
                        {result.error ?? result.finalState ?? "unknown"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={7}>
                      No download results yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="font-medium">Latest status</h2>
          <pre className="min-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {status ? JSON.stringify(status, null, 2) : "No status yet."}
          </pre>
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Preview</h2>
          <CopyButton
            label="Copy latest preview"
            value={results[0]?.preview ?? ""}
            disabled={!results[0]?.preview}
          />
        </div>
        <pre className="min-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {results[0]?.preview || "No download preview yet."}
        </pre>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Auth trace</h2>
          <CopyButton
            label="Copy auth trace"
            value={toDebugJson(authTrace)}
            disabled={authTrace.length === 0}
          />
        </div>
        <div className="max-h-80 overflow-auto rounded-md border">
          {authTrace.length > 0 ? (
            <ol className="divide-y">
              {authTrace.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className="flex flex-col gap-1 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">auth</Badge>
                    <span className="font-medium">{entry.step}</span>
                    <time className="font-mono text-xs text-muted-foreground">
                      {formatTime(entry.at)}
                    </time>
                    <CopyButton
                      label="Copy auth event"
                      value={toDebugJson(entry)}
                      size="xs"
                    />
                  </div>
                  {entry.detail ? (
                    <pre className="overflow-auto font-mono text-xs text-muted-foreground">
                      {JSON.stringify(entry.detail, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-3 text-muted-foreground">No auth events yet.</p>
          )}
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Event log</h2>
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

function useBrowserBluetoothSupport(): boolean {
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    setIsSupported(BleTransferBrowserClient.isSupported())
  }, [])

  return isSupported
}

function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function decodePreview(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 2048))
}

function nowMs(): number {
  return performance.now()
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
