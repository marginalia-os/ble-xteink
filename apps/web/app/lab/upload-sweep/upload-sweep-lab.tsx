"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  BluetoothIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  RefreshCwIcon,
  SendIcon,
  UnplugIcon,
} from "lucide-react"

import { CopyButton } from "@/app/lab/components/copy-button"
import {
  BleTransferBrowserClient,
  type BleLabEvent,
  type BleWriteMode,
} from "@/lib/ble/client"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  sha256Hex,
  type StartPutCommand,
  type TransferStatus,
} from "@workspace/ble-protocol"

type ConnectionState = "idle" | "connecting" | "connected" | "error"
type SweepMode = "response" | "without-response" | "windowed"
type SweepState = "idle" | "running" | "done" | "error"
type PayloadPreset = "small" | "256kb" | "1mb"

interface SweepSettings {
  chunkSizes: string
  mode: SweepMode
  ackBytes: string
  chunkDelayMs: string
  payloadPreset: PayloadPreset
}

interface SweepRunOptions {
  clearResults?: boolean
}

interface SweepRunOutcome {
  completed: boolean
  results: SweepResult[]
}

interface SweepResult {
  name: string
  mode: SweepMode
  chunkSize: number
  frameBytes: number
  ackBytes?: number
  chunkDelayMs: number
  payloadBytes: number
  durationMs: number
  bytesPerSecond: number
  finalState?: string
  error?: string
}

const RECOMMENDED_256KB_SETTINGS: SweepSettings = {
  chunkSizes: "500",
  mode: "windowed",
  ackBytes: "24000",
  chunkDelayMs: "0",
  payloadPreset: "256kb",
}

const RECOMMENDED_1MB_SETTINGS: SweepSettings = {
  ...RECOMMENDED_256KB_SETTINGS,
  payloadPreset: "1mb",
}

const CONSERVATIVE_256KB_SETTINGS: SweepSettings = {
  ...RECOMMENDED_256KB_SETTINGS,
  ackBytes: "8000",
}

const VERY_SAFE_256KB_SETTINGS: SweepSettings = {
  ...RECOMMENDED_256KB_SETTINGS,
  ackBytes: "160",
  chunkDelayMs: "1",
}

const MID_WINDOW_256KB_SETTINGS: SweepSettings = {
  ...RECOMMENDED_256KB_SETTINGS,
  ackBytes: "16000",
}

const MID_WINDOW_1MB_SETTINGS: SweepSettings = {
  ...MID_WINDOW_256KB_SETTINGS,
  payloadPreset: "1mb",
}

const HIGH_WINDOW_256KB_SETTINGS: SweepSettings = {
  ...RECOMMENDED_256KB_SETTINGS,
  ackBytes: "32000",
}

const HIGH_WINDOW_1MB_SETTINGS: SweepSettings = {
  ...HIGH_WINDOW_256KB_SETTINGS,
  payloadPreset: "1mb",
}

const AUTO_TUNE_SETTINGS: SweepSettings[] = [
  CONSERVATIVE_256KB_SETTINGS,
  { ...CONSERVATIVE_256KB_SETTINGS, payloadPreset: "1mb" },
  MID_WINDOW_256KB_SETTINGS,
  MID_WINDOW_1MB_SETTINGS,
  RECOMMENDED_256KB_SETTINGS,
  RECOMMENDED_1MB_SETTINGS,
  HIGH_WINDOW_256KB_SETTINGS,
  HIGH_WINDOW_1MB_SETTINGS,
]

export function UploadSweepLab() {
  const clientRef = useRef<BleTransferBrowserClient | null>(null)
  const statusRef = useRef<TransferStatus | null>(null)
  const statusVersionRef = useRef(0)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle")
  const [sweepState, setSweepState] = useState<SweepState>("idle")
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const [events, setEvents] = useState<BleLabEvent[]>([])
  const [results, setResults] = useState<SweepResult[]>([])
  const [code, setCode] = useState("")
  const [chunkSizes, setChunkSizes] = useState("20, 160, 244, 500")
  const [mode, setMode] = useState<SweepMode>("response")
  const [ackBytes, setAckBytes] = useState("960")
  const [chunkDelayMs, setChunkDelayMs] = useState("5")
  const [payloadPreset, setPayloadPreset] = useState<PayloadPreset>("256kb")
  const [autoCopyMessage, setAutoCopyMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isSupported = useBrowserBluetoothSupport()

  const isBusy = connectionState === "connecting"
  const isConnected = connectionState === "connected"
  const isRunning = sweepState === "running"
  const parsedChunkSizes = parseChunkSizes(chunkSizes)
  const ackBytesValue = Number.parseInt(ackBytes, 10)
  const ackBytesValid =
    mode !== "windowed" ||
    (Number.isInteger(ackBytesValue) && ackBytesValue > 0)
  const chunkDelayValue = Number.parseFloat(chunkDelayMs)
  const chunkDelayValid =
    Number.isFinite(chunkDelayValue) && chunkDelayValue >= 0

  async function connect() {
    setError(null)
    setConnectionState("connecting")
    setEvents([])
    setStatus(null)

    const client = new BleTransferBrowserClient({
      onEvent: appendEvent,
      onStatus: updateStatus,
      onDisconnect: () => {
        setConnectionState("idle")
      },
    })

    clientRef.current = client

    try {
      await client.connect()
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

  function getCurrentSweepSettings(): SweepSettings {
    return {
      chunkSizes,
      mode,
      ackBytes,
      chunkDelayMs,
      payloadPreset,
    }
  }

  function applySweepSettings(settings: SweepSettings) {
    setChunkSizes(settings.chunkSizes)
    setMode(settings.mode)
    setAckBytes(settings.ackBytes)
    setChunkDelayMs(settings.chunkDelayMs)
    setPayloadPreset(settings.payloadPreset)
  }

  async function runRecommended(settings: SweepSettings) {
    applySweepSettings(settings)
    await runSweep(settings)
  }

  async function runAutoTune() {
    setError(null)
    setAutoCopyMessage(null)
    setResults([])
    const collectedResults: SweepResult[] = []

    for (const settings of AUTO_TUNE_SETTINGS) {
      applySweepSettings(settings)
      const outcome = await runSweep(settings, { clearResults: false })
      collectedResults.push(...outcome.results)
      if (!outcome.completed) {
        await copyAutoTuneResults(collectedResults)
        return
      }
    }

    await copyAutoTuneResults(collectedResults)
  }

  async function runSweep(
    settings = getCurrentSweepSettings(),
    options: SweepRunOptions = {}
  ): Promise<SweepRunOutcome> {
    const client = clientRef.current
    if (!client) return { completed: false, results: [] }

    const sizes = parseChunkSizes(settings.chunkSizes)
    const parsedAckBytes = Number.parseInt(settings.ackBytes, 10)
    const parsedChunkDelayMs = Number.parseFloat(settings.chunkDelayMs)
    const runResults: SweepResult[] = []

    if (sizes.length === 0) {
      setError("Enter at least one chunk size.")
      return { completed: false, results: runResults }
    }
    if (settings.mode === "windowed" && !Number.isInteger(parsedAckBytes)) {
      setError("Enter a numeric ACK window.")
      return { completed: false, results: runResults }
    }
    if (!Number.isFinite(parsedChunkDelayMs) || parsedChunkDelayMs < 0) {
      setError("Enter a valid chunk delay.")
      return { completed: false, results: runResults }
    }

    const payload = createBmpPayloadForPreset(settings.payloadPreset)
    const digest = await sha256Hex(viewToBufferSource(payload))
    const runId = createRunId()

    setError(null)
    if (options.clearResults !== false) {
      setResults([])
    }
    setSweepState("running")

    for (const chunkSize of sizes) {
      const name = `lab-${runId}-${modeName(settings.mode)}-${chunkSize}.bmp`
      const startedAt = nowMs()

      try {
        await uploadOnce({
          client,
          payload,
          digest,
          name,
          chunkSize,
          mode: settings.mode,
          ackBytes: parsedAckBytes,
          chunkDelayMs: parsedChunkDelayMs,
        })

        const finalStatusVersion = statusVersionRef.current
        await client.writeControl({ op: "commit" })
        const finalStatus = await waitForStatus(
          (candidate) =>
            candidate.state === "saved" || candidate.state === "error",
          15_000,
          finalStatusVersion
        )
        const durationMs = nowMs() - startedAt
        const result: SweepResult = {
          name,
          mode: settings.mode,
          chunkSize,
          frameBytes: chunkSize + 4,
          ackBytes: settings.mode === "windowed" ? parsedAckBytes : undefined,
          chunkDelayMs: parsedChunkDelayMs,
          payloadBytes: payload.byteLength,
          durationMs,
          bytesPerSecond: Math.round((payload.byteLength / durationMs) * 1000),
          finalState: finalStatus?.state,
          error: finalStatus?.error,
        }
        runResults.push(result)
        setResults((current) => [...current, result])

        if (finalStatus?.state === "error") {
          setSweepState("error")
          setError(finalStatus.error ?? "Device reported an error.")
          return { completed: false, results: runResults }
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Sweep failed."
        const durationMs = nowMs() - startedAt
        const result: SweepResult = {
          name,
          mode: settings.mode,
          chunkSize,
          frameBytes: chunkSize + 4,
          ackBytes: settings.mode === "windowed" ? parsedAckBytes : undefined,
          chunkDelayMs: parsedChunkDelayMs,
          payloadBytes: payload.byteLength,
          durationMs,
          bytesPerSecond: 0,
          finalState: statusRef.current?.state,
          error: message,
        }
        runResults.push(result)
        setResults((current) => [...current, result])
        setSweepState("error")
        setError(message)
        await client.writeControl({ op: "cancel" }).catch(() => undefined)
        return { completed: false, results: runResults }
      }
    }

    setSweepState("done")
    return { completed: true, results: runResults }
  }

  async function copyAutoTuneResults(value: SweepResult[]) {
    if (value.length === 0) return

    try {
      await navigator.clipboard.writeText(toDebugJson(value))
      setAutoCopyMessage(`Copied ${value.length} auto tune results.`)
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Clipboard write failed."
      setAutoCopyMessage(`Auto tune finished, but copy failed: ${message}`)
    }
  }

  async function uploadOnce({
    client,
    payload,
    digest,
    name,
    chunkSize,
    mode,
    ackBytes,
    chunkDelayMs,
  }: {
    client: BleTransferBrowserClient
    payload: Uint8Array
    digest: string
    name: string
    chunkSize: number
    mode: SweepMode
    ackBytes: number
    chunkDelayMs: number
  }) {
    const command: StartPutCommand = {
      op: "start_put",
      kind: "bmp",
      name,
      size: payload.byteLength,
      sha256: digest,
      resume: false,
      chunk_size: chunkSize,
    }
    if (mode === "windowed") command.ack_bytes = ackBytes

    const startStatusVersion = statusVersionRef.current
    await client.writeControl(command)

    const startStatus = await waitForStatus(
      (candidate) =>
        candidate.state === "receiving" || candidate.state === "error",
      8_000,
      startStatusVersion
    )
    if (!startStatus) throw new Error("Timed out waiting for receiving state.")
    if (startStatus.state === "error") {
      throw new Error(startStatus.error ?? "Device rejected transfer.")
    }

    let sequence = 0
    let sentBytes = 0
    let ackFloor = 0
    const writeMode: BleWriteMode =
      mode === "response" ? "response" : "without-response"

    while (sentBytes < payload.byteLength) {
      const next = Math.min(sentBytes + chunkSize, payload.byteLength)
      await client.writeDataFrame(
        sequence,
        payload.slice(sentBytes, next),
        writeMode
      )
      sequence += 1
      sentBytes = next

      if (chunkDelayMs > 0) {
        await delay(chunkDelayMs)
      }

      if (mode === "windowed" && sentBytes - ackFloor >= ackBytes) {
        ackFloor = sentBytes
        await waitForReceived(ackFloor, 8_000)
      }
    }

    if (mode === "windowed") {
      await waitForReceived(sentBytes, 8_000)
    }
  }

  function updateStatus(nextStatus: TransferStatus) {
    statusVersionRef.current += 1
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }

  function appendEvent(event: BleLabEvent) {
    setEvents((current) => [event, ...current].slice(0, 120))
  }

  function waitForReceived(bytes: number, timeoutMs: number) {
    return waitForStatus((candidate) => {
      if (candidate.state === "error") return true
      return (
        typeof candidate.received === "number" && candidate.received >= bytes
      )
    }, timeoutMs).then((candidate) => {
      if (!candidate)
        throw new Error(`Timed out waiting for ${bytes} received bytes.`)
      if (candidate.state === "error") {
        throw new Error(candidate.error ?? "Device reported an error.")
      }
      return candidate
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

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 px-5 py-6 text-sm sm:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-medium">
            BLE upload sweep
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
            {sweepState}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Upload small generated BMP files to measure browser write behavior
          before building the public transfer screen.
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
              <FieldLabel htmlFor="sweep-visible-code">Visible code</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="sweep-visible-code"
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
                Use only when the lab is not already authorized.
              </FieldDescription>
            </Field>

            <Field data-invalid={parsedChunkSizes.length === 0}>
              <FieldLabel htmlFor="sweep-chunk-sizes">Chunk sizes</FieldLabel>
              <Input
                id="sweep-chunk-sizes"
                value={chunkSizes}
                onChange={(event) => setChunkSizes(event.target.value)}
                aria-label="Chunk sizes"
                aria-invalid={parsedChunkSizes.length === 0}
                className="font-mono"
              />
              {parsedChunkSizes.length === 0 ? (
                <FieldError>
                  Enter one or more positive byte sizes, separated by commas.
                </FieldError>
              ) : (
                <FieldDescription>
                  Example: 500 or 160, 244, 500.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel>Write mode</FieldLabel>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as SweepMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="response">response</SelectItem>
                    <SelectItem value="without-response">
                      without response
                    </SelectItem>
                    <SelectItem value="windowed">
                      windowed without response
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field
              data-disabled={mode !== "windowed"}
              data-invalid={!ackBytesValid}
            >
              <FieldLabel htmlFor="sweep-ack-bytes">ACK bytes</FieldLabel>
              <Input
                id="sweep-ack-bytes"
                value={ackBytes}
                onChange={(event) =>
                  setAckBytes(event.target.value.replace(/\D/g, ""))
                }
                disabled={mode !== "windowed"}
                inputMode="numeric"
                aria-label="ACK bytes"
                aria-invalid={!ackBytesValid}
                className="font-mono"
              />
              {!ackBytesValid ? (
                <FieldError>
                  Enter a positive byte window, for example 24000.
                </FieldError>
              ) : (
                <FieldDescription>
                  Used only for windowed writes.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={!chunkDelayValid}>
              <FieldLabel htmlFor="sweep-chunk-delay">
                Chunk delay ms
              </FieldLabel>
              <Input
                id="sweep-chunk-delay"
                value={chunkDelayMs}
                onChange={(event) =>
                  setChunkDelayMs(event.target.value.replace(/[^\d.]/g, ""))
                }
                inputMode="decimal"
                aria-label="Chunk delay milliseconds"
                aria-invalid={!chunkDelayValid}
                className="font-mono"
              />
              {!chunkDelayValid ? (
                <FieldError>Enter zero or a positive delay.</FieldError>
              ) : (
                <FieldDescription>
                  Zero uses the browser’s fastest loop.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel>Payload</FieldLabel>
              <Select
                value={payloadPreset}
                onValueChange={(value) =>
                  setPayloadPreset(value as PayloadPreset)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="small">12 KB BMP</SelectItem>
                    <SelectItem value="256kb">256 KB BMP</SelectItem>
                    <SelectItem value="1mb">1 MB BMP</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={runAutoTune}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Auto tune pass
          </Button>
          <Button
            onClick={() => runSweep()}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Run sweep
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(RECOMMENDED_256KB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Recommended 256 KB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(RECOMMENDED_1MB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />1 MB check
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(CONSERVATIVE_256KB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Safe 256 KB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(VERY_SAFE_256KB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Very safe 256 KB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(MID_WINDOW_256KB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            16 KB window 256 KB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(MID_WINDOW_1MB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            16 KB window 1 MB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(HIGH_WINDOW_256KB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            32 KB window 256 KB
          </Button>
          <Button
            variant="outline"
            onClick={() => runRecommended(HIGH_WINDOW_1MB_SETTINGS)}
            disabled={!isConnected || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            32 KB window 1 MB
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
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Action blocked</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
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
            <Table className="min-w-[42rem] text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Chunk</TableHead>
                  <TableHead>Frame</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>ACK</TableHead>
                  <TableHead>Delay</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length > 0 ? (
                  results.map((result) => (
                    <TableRow key={result.name}>
                      <TableCell className="font-mono">
                        {result.chunkSize}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.frameBytes}
                      </TableCell>
                      <TableCell>{result.mode}</TableCell>
                      <TableCell className="font-mono">
                        {result.ackBytes ?? "-"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.chunkDelayMs} ms
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
                    <TableCell className="text-muted-foreground" colSpan={8}>
                      No sweep results yet.
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

function parseChunkSizes(value: string): number[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => Number.isInteger(part) && part > 0)
    )
  )
}

function createBmpPayloadForPreset(preset: PayloadPreset): Uint8Array {
  switch (preset) {
    case "small":
      return createBmpPayload(64, 64)
    case "256kb":
      return createBmpPayload(296, 296)
    case "1mb":
      return createBmpPayload(592, 592)
  }
}

function createBmpPayload(width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowBytes * height
  const fileBytes = 54 + pixelBytes
  const bytes = new Uint8Array(fileBytes)
  const view = new DataView(bytes.buffer)

  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, fileBytes, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelBytes, true)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowBytes + x * 3
      bytes[offset] = (x * 4) & 0xff
      bytes[offset + 1] = (y * 4) & 0xff
      bytes[offset + 2] = 0x80
    }
  }

  return bytes
}

function viewToBufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer
}

function createRunId(): string {
  return Date.now().toString(36)
}

function nowMs(): number {
  return performance.now()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function modeName(mode: SweepMode): string {
  return mode === "without-response" ? "nr" : mode
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
