"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  BluetoothIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  SendIcon,
  UnplugIcon,
  UploadIcon,
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
import { Progress } from "@workspace/ui/components/progress"
import { Separator } from "@workspace/ui/components/separator"
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
  DEFAULT_DOWNLOAD_CHUNK_BYTES,
  inferUploadKindFromName,
  repairPackageId,
  repairUploadName,
  sha256Hex,
  uploadSuffixForKind,
  type DataFrame,
  type DownloadKind,
  type StartGetCommand,
  type StartPutCommand,
  type TransferStatus,
  type UploadKind,
} from "@workspace/ble-protocol"

type ConnectionState = "idle" | "connecting" | "connected" | "error"
type WorkState = "idle" | "running" | "done" | "error"

interface TransferResult {
  action: "upload" | "download"
  bytes: number
  durationMs: number
  finalState?: string
  name?: string
  kind: string
  rate: number
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

const UPLOAD_CHUNK_BYTES = 500
const UPLOAD_ACK_BYTES = 24_000
const DOWNLOAD_CHUNK_BYTES = DEFAULT_DOWNLOAD_CHUNK_BYTES
const LAST_PACKAGE_ID_STORAGE_KEY = "ble-xteink:last-package-id"

export function TransferClient() {
  const clientRef = useRef<BleTransferBrowserClient | null>(null)
  const statusRef = useRef<TransferStatus | null>(null)
  const statusVersionRef = useRef(0)
  const activeDownloadRef = useRef<ActiveDownload | null>(null)
  const pendingTrustedHostRef = useRef<PendingTrustedHost | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle")
  const [workState, setWorkState] = useState<WorkState>("idle")
  const [status, setStatus] = useState<TransferStatus | null>(null)
  const [events, setEvents] = useState<BleLabEvent[]>([])
  const [results, setResults] = useState<TransferResult[]>([])
  const [sessionAuthorized, setSessionAuthorized] = useState(false)
  const [code, setCode] = useState("")
  const [packageId, setPackageId] = useState("")
  const [uploadKind, setUploadKind] = useState<UploadKind>("package")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isSupported = useBrowserBluetoothSupport()

  const isBusy = connectionState === "connecting"
  const isConnected = connectionState === "connected"
  const isRunning = workState === "running"
  const selectedUploadNameRepair = selectedFile
    ? repairUploadName(selectedFile.name, uploadKind)
    : null
  const packageIdRepair = packageId ? repairPackageId(packageId) : null
  const progress = transferProgress(status)
  const debugReport = toDebugJson({
    connectionState,
    error,
    events,
    message,
    packageId: packageId.trim() || null,
    results,
    sessionAuthorized,
    status,
    upload: {
      fileName: selectedFile?.name ?? null,
      kind: uploadKind,
      repairedName: selectedUploadNameRepair?.safeName ?? null,
    },
    workState,
  })

  useEffect(() => {
    const savedPackageId = window.localStorage.getItem(
      LAST_PACKAGE_ID_STORAGE_KEY
    )
    if (savedPackageId) setPackageId(savedPackageId)
  }, [])

  async function connect() {
    setError(null)
    setMessage(null)
    setEvents([])
    setStatus(null)
    setConnectionState("connecting")

    const client = new BleTransferBrowserClient({
      onDataOut: handleDataOut,
      onEvent: appendEvent,
      onStatus: updateStatus,
      onDisconnect: () => {
        activeDownloadRef.current = null
        setSessionAuthorized(false)
        setConnectionState("idle")
      },
    })
    clientRef.current = client

    try {
      try {
        await client.connectKnown()
      } catch (knownError) {
        appendEvent({
          at: new Date().toISOString(),
          type: "info",
          message:
            knownError instanceof Error
              ? knownError.message
              : "Known-device reconnect was not available.",
        })
        await client.connect()
      }
      setConnectionState("connected")
      const trusted = await tryTrustedAuth(client)
      setSessionAuthorized(trusted)
      if (trusted) {
        setMessage("Trusted browser connected.")
      } else {
        setMessage("Connected, but this session is not authorized yet.")
      }
    } catch (caught) {
      const next = caught instanceof Error ? caught.message : "Connect failed."
      setError(next)
      setConnectionState("error")
    }
  }

  async function disconnect() {
    setError(null)
    activeDownloadRef.current = null
    await clientRef.current?.disconnect()
    clientRef.current = null
    setSessionAuthorized(false)
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

  async function sendCode() {
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code shown on the reader.")
      return
    }

    const client = clientRef.current
    if (!client) return

    try {
      const currentStatus = statusRef.current ?? (await client.readStatus())
      const pairing = createPairingHello(currentStatus, code)
      if (!pairing) throw new Error("Could not prepare browser pairing.")

      pendingTrustedHostRef.current = pairing
      const helloVersion = statusVersionRef.current
      await client.writeControl(pairing.command)
      const helloStatus = await waitForStatus(
        (candidate) =>
          candidate.state === "connected" || candidate.state === "error",
        8_000,
        helloVersion
      )
      if (helloStatus?.state === "error") {
        throw new Error(helloStatus.error ?? "Code rejected.")
      }
      setSessionAuthorized(true)

      const saveVersion = statusVersionRef.current
      await client.writeControl(pairing.saveCommand)
      setMessage("Confirm save-browser on the reader.")
      const saveStatus = await waitForStatus(
        (candidate) =>
          Boolean(candidate.paired) ||
          candidate.pairing === "skipped" ||
          candidate.state === "error",
        30_000,
        saveVersion
      )
      if (!saveStatus) throw new Error("Timed out waiting for confirmation.")
      if (saveStatus.state === "error") {
        throw new Error(saveStatus.error ?? "Pairing failed.")
      }
      if (saveStatus.pairing === "skipped") {
        throw new Error("Reader skipped browser pairing.")
      }
      setMessage("Trusted browser saved.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Code auth failed.")
    }
  }

  function chooseUploadFile(file: File | null) {
    setSelectedFile(file)
    setError(null)
    setMessage(null)
    if (!file) return

    const inferredKind = inferUploadKindFromName(file.name)
    if (
      inferredKind &&
      inferredKind !== "firmware" &&
      inferredKind !== uploadKind
    ) {
      setUploadKind(inferredKind)
      setMessage(
        `Upload kind changed to ${uploadKindLabel(inferredKind)} because the file ends in ${uploadSuffixForKind(inferredKind)}.`
      )
    }
  }

  async function tryTrustedAuth(client: BleTransferBrowserClient) {
    const nextStatus = await client.readStatus()
    const savedHost = getTrustedHost(nextStatus.device_id)
    if (!savedHost) {
      setMessage("Enter the code once to save this browser.")
      return false
    }

    const command = await createTrustedHello(nextStatus)
    if (!command) {
      setMessage("Saved browser found, but the reader did not send a nonce.")
      return false
    }

    const version = statusVersionRef.current
    await client.writeControl(command)
    const authStatus = await waitForStatus(
      (candidate) =>
        Boolean(candidate.trusted_host) || candidate.state === "error",
      8_000,
      version
    )
    if (authStatus?.trusted_host) {
      setSessionAuthorized(true)
      return true
    }

    setSessionAuthorized(false)
    setMessage("Saved browser was not accepted. Use the code once.")
    return false
  }

  function forgetBrowser() {
    forgetTrustedHost(statusRef.current?.device_id)
    pendingTrustedHostRef.current = null
    setSessionAuthorized(false)
    setMessage("Forgot saved browser for this reader.")
  }

  async function runTransferCheck() {
    if (!clientRef.current || !sessionAuthorized) {
      setError(
        "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
      )
      return
    }

    setError(null)
    setMessage(null)
    setResults([])

    const collected: TransferResult[] = []
    const bmpPayload = createBmpPayload(160, 160)

    const uploadResult = await uploadBytes({
      payload: bmpPayload,
      fileName: createTransferCheckBmpName(),
      kind: "bmp",
    })
    if (uploadResult) collected.push(uploadResult)
    if (uploadResult?.error) {
      await copyAndPostTransferCheck(collected)
      return
    }

    const crashReportResult = await runDownload({ kind: "crash_report" })
    if (crashReportResult) collected.push(crashReportResult)

    await copyAndPostTransferCheck(collected)
  }

  async function uploadSelectedFile() {
    const file = selectedFile
    if (!file) return
    if (!sessionAuthorized) {
      setError(
        "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
      )
      return
    }

    setError(null)
    const payload = new Uint8Array(await file.arrayBuffer())
    await uploadBytes({
      payload,
      fileName: file.name,
      kind: uploadKind,
    })
  }

  async function uploadBytes({
    payload,
    fileName,
    kind,
  }: {
    payload: Uint8Array
    fileName: string
    kind: UploadKind
  }): Promise<TransferResult | null> {
    const client = clientRef.current
    if (!client) return null
    if (!sessionAuthorized) {
      setError(
        "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
      )
      return null
    }

    setError(null)
    const nameRepair = repairUploadName(fileName, kind)
    if (!nameRepair.safeName) {
      setError(nameRepair.message)
      return null
    }
    if (nameRepair.reason === "repaired-basename") {
      setMessage(nameRepair.message)
    }

    setWorkState("running")
    const startedAt = nowMs()
    try {
      const digest = await sha256Hex(toArrayBuffer(payload))
      const command: StartPutCommand = {
        op: "start_put",
        kind,
        name: nameRepair.safeName,
        size: payload.byteLength,
        sha256: digest,
        resume: false,
        chunk_size: UPLOAD_CHUNK_BYTES,
        ack_bytes: UPLOAD_ACK_BYTES,
      }

      const startVersion = statusVersionRef.current
      await client.writeControl(command)
      const startStatus = await waitForStatus(
        (candidate) =>
          candidate.state === "receiving" || candidate.state === "error",
        8_000,
        startVersion
      )
      if (!startStatus) throw new Error("Timed out waiting for upload start.")
      if (startStatus.state === "error") {
        throw new Error(
          explainReaderError(startStatus.error, "Reader rejected upload.")
        )
      }

      let sequence = 0
      let sentBytes = 0
      let ackFloor = 0
      while (sentBytes < payload.byteLength) {
        const next = Math.min(
          sentBytes + UPLOAD_CHUNK_BYTES,
          payload.byteLength
        )
        await client.writeDataFrame(
          sequence,
          payload.slice(sentBytes, next),
          "without-response"
        )
        sequence += 1
        sentBytes = next
        if (sentBytes - ackFloor >= UPLOAD_ACK_BYTES) {
          ackFloor = sentBytes
          await waitForReceived(ackFloor, 10_000)
        }
      }
      await waitForReceived(sentBytes, 10_000)

      const commitVersion = statusVersionRef.current
      await client.writeControl({ op: "commit" })
      const finalStatus = await waitForStatus(
        (candidate) =>
          candidate.state === "saved" ||
          candidate.state === "installed" ||
          candidate.state === "error",
        120_000,
        commitVersion
      )
      if (!finalStatus) throw new Error("Timed out waiting for commit.")
      if (finalStatus.state === "error") {
        throw new Error(
          explainReaderError(finalStatus.error, "Reader reported an error.")
        )
      }

      const durationMs = nowMs() - startedAt
      const result: TransferResult = {
        action: "upload",
        bytes: payload.byteLength,
        durationMs,
        finalState: finalStatus.state,
        kind,
        name: nameRepair.safeName,
        rate: Math.round((payload.byteLength / durationMs) * 1000),
      }
      addResult(result)
      setWorkState("done")
      return result
    } catch (caught) {
      const next =
        caught instanceof Error
          ? explainReaderError(caught.message, "Upload failed.")
          : "Upload failed."
      await client.writeControl({ op: "cancel" }).catch(() => undefined)
      setError(next)
      setWorkState("error")
      const result: TransferResult = {
        action: "upload",
        bytes: payload.byteLength,
        durationMs: nowMs() - startedAt,
        error: next,
        finalState: statusRef.current?.state,
        kind,
        name: nameRepair.safeName,
        rate: 0,
      }
      addResult(result)
      return result
    }
  }

  async function downloadCrashReport() {
    if (!sessionAuthorized) {
      setError(
        "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
      )
      return
    }
    await runDownload({ kind: "crash_report" })
  }

  async function downloadPackageState() {
    if (!sessionAuthorized) {
      setError(
        "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
      )
      return
    }
    const repaired = repairPackageId(packageId)
    if (!repaired.safeId) {
      setError(repaired.message)
      return
    }
    if (repaired.safeId !== packageId) {
      setPackageId(repaired.safeId)
      setMessage(repaired.message)
    }
    const result = await runDownload({
      kind: "package_state",
      packageId: repaired.safeId,
    })
    if (!result?.error) {
      window.localStorage.setItem(LAST_PACKAGE_ID_STORAGE_KEY, repaired.safeId)
    }
  }

  async function runDownload({
    kind,
    packageId,
  }: {
    kind: DownloadKind
    packageId?: string
  }): Promise<TransferResult | null> {
    const client = clientRef.current
    if (!client) return null

    const active: ActiveDownload = {
      chunks: [],
      client,
      expectedSequence: 0,
      frameCount: 0,
      receivedBytes: 0,
    }
    activeDownloadRef.current = active
    setError(null)
    setWorkState("running")
    const startedAt = nowMs()

    try {
      const command: StartGetCommand = {
        op: "start_get",
        kind,
        chunk_size: DOWNLOAD_CHUNK_BYTES,
      }
      if (packageId) command.package_id = packageId
      const startVersion = statusVersionRef.current
      await client.writeControl(command)
      const startStatus = await waitForStatus(
        (candidate) =>
          candidate.state === "sending" ||
          candidate.state === "sent" ||
          candidate.state === "error",
        8_000,
        startVersion
      )
      if (!startStatus) throw new Error("Timed out waiting for download start.")
      if (startStatus.state === "error") {
        throw new Error(
          explainReaderError(startStatus.error, "Reader rejected download.")
        )
      }

      const finalStatus = await waitForDownloadEnd(active, 60_000)
      if (active.error) throw new Error(active.error)
      if (!finalStatus) throw new Error("Timed out waiting for download end.")
      if (finalStatus.state === "error") {
        throw new Error(
          explainReaderError(finalStatus.error, "Reader reported an error.")
        )
      }
      if (finalStatus.state !== "sent") {
        throw new Error(`Unexpected final state: ${finalStatus.state}`)
      }

      const expected =
        typeof finalStatus.size === "number" ? finalStatus.size : undefined
      if (typeof expected === "number" && active.receivedBytes !== expected) {
        throw new Error(
          `Received ${active.receivedBytes}, expected ${expected}.`
        )
      }

      const durationMs = nowMs() - startedAt
      const result: TransferResult = {
        action: "download",
        bytes: active.receivedBytes,
        durationMs,
        finalState: finalStatus.state,
        kind,
        name: finalStatus.name,
        rate: Math.round((active.receivedBytes / durationMs) * 1000),
      }
      addResult(result)
      setWorkState("done")
      return result
    } catch (caught) {
      const next =
        caught instanceof Error
          ? explainReaderError(caught.message, "Download failed.")
          : "Download failed."
      await client.writeControl({ op: "cancel" }).catch(() => undefined)
      setError(next)
      setWorkState("error")
      const result: TransferResult = {
        action: "download",
        bytes: active.receivedBytes,
        durationMs: nowMs() - startedAt,
        error: next,
        finalState: statusRef.current?.state,
        kind,
        rate: 0,
      }
      addResult(result)
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
    if (nextStatus.trusted_host) {
      setSessionAuthorized(true)
    }
    if (
      nextStatus.state === "error" &&
      nextStatus.error === "session code required"
    ) {
      setSessionAuthorized(false)
    }
    if (pending && nextStatus.paired) {
      rememberTrustedHost(pending.record)
      pendingTrustedHostRef.current = null
      setMessage("Saved this browser for trusted auth.")
    } else if (pending && nextStatus.pairing === "skipped") {
      pendingTrustedHostRef.current = null
      setMessage("Reader skipped browser pairing.")
    }
  }

  function appendEvent(event: BleLabEvent) {
    setEvents((current) => [event, ...current].slice(0, 80))
  }

  function addResult(result: TransferResult) {
    setResults((current) => [result, ...current].slice(0, 20))
  }

  async function copyAndPostTransferCheck(value: TransferResult[]) {
    if (value.length === 0) return

    try {
      await navigator.clipboard.writeText(toDebugJson(value))
      setMessage(`Transfer check finished and copied ${value.length} results.`)
    } catch (caught) {
      const detail =
        caught instanceof Error ? caught.message : "Clipboard write failed."
      setMessage(`Transfer check finished, but copy failed: ${detail}`)
    }

    try {
      const response = await fetch("/api/lab-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "transfer-check", value }),
      })
      if (!response.ok) {
        throw new Error(`Report route returned ${response.status}.`)
      }
    } catch (caught) {
      const detail =
        caught instanceof Error ? caught.message : "Report write failed."
      setMessage(`Transfer check finished, but local report failed: ${detail}`)
    }
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
        throw new Error(candidate.error ?? "Reader reported an error.")
      }
      return candidate
    })
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

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 px-5 py-6 text-sm sm:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-medium">BLE transfer</h1>
            <Badge variant={isSupported ? "secondary" : "destructive"}>
              {isSupported
                ? "Web Bluetooth available"
                : "Web Bluetooth unavailable"}
            </Badge>
            <Badge variant={isConnected ? "default" : "outline"}>
              {connectionState}
            </Badge>
            <Badge variant={isRunning ? "secondary" : "outline"}>
              {workState}
            </Badge>
          </div>
          <CopyButton label="Copy report" value={debugReport} />
        </div>
      </header>

      <section className="flex flex-col gap-4 border-y py-5">
        <div className="flex flex-wrap gap-2">
          <Button
            id="connect-button"
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
              <FieldLabel htmlFor="visible-code">Visible code</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="visible-code"
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
                  id="save-code-button"
                  variant="secondary"
                  onClick={sendCode}
                  disabled={!isConnected || isRunning}
                >
                  <SendIcon data-icon="inline-start" />
                  Save
                </Button>
              </div>
              <FieldDescription>
                Only needed once when this browser is not trusted yet.
              </FieldDescription>
            </Field>

            <Field
              data-invalid={Boolean(
                selectedUploadNameRepair?.safeName === undefined && selectedFile
              )}
            >
              <FieldLabel htmlFor="upload-file">Upload file</FieldLabel>
              <Input
                id="upload-file"
                type="file"
                accept={acceptForUploadKind(uploadKind)}
                aria-label="Upload file"
                aria-invalid={Boolean(
                  selectedUploadNameRepair?.safeName === undefined &&
                  selectedFile
                )}
                onChange={(event) =>
                  chooseUploadFile(event.currentTarget.files?.[0] ?? null)
                }
              />
              {selectedUploadNameRepair?.safeName ? (
                <FieldDescription>
                  {selectedUploadNameRepair.message}
                </FieldDescription>
              ) : selectedUploadNameRepair ? (
                <FieldError>{selectedUploadNameRepair.message}</FieldError>
              ) : (
                <FieldDescription>
                  Pick a file that matches the selected upload kind.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel>Upload kind</FieldLabel>
              <Select
                value={uploadKind}
                onValueChange={(value) => setUploadKind(value as UploadKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="package">Package</SelectItem>
                    <SelectItem value="book">Book</SelectItem>
                    <SelectItem value="bmp">BMP</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field
              data-invalid={Boolean(packageIdRepair && !packageIdRepair.safeId)}
            >
              <FieldLabel htmlFor="package-id">Package id</FieldLabel>
              <Input
                id="package-id"
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
                aria-label="Package id"
                aria-invalid={Boolean(
                  packageIdRepair && !packageIdRepair.safeId
                )}
                className="font-mono"
                placeholder="org.example.package"
              />
              {packageIdRepair && !packageIdRepair.safeId ? (
                <FieldError>{packageIdRepair.message}</FieldError>
              ) : packageIdRepair ? (
                <FieldDescription>{packageIdRepair.message}</FieldDescription>
              ) : (
                <FieldDescription>
                  Required only for package-state diagnostics.
                </FieldDescription>
              )}
            </Field>
          </div>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={uploadSelectedFile}
            disabled={
              !isConnected ||
              !sessionAuthorized ||
              isRunning ||
              !selectedFile ||
              !selectedUploadNameRepair?.safeName
            }
          >
            <UploadIcon data-icon="inline-start" />
            Upload
          </Button>
          <Button
            id="crash-report-button"
            variant="outline"
            onClick={downloadCrashReport}
            disabled={!isConnected || !sessionAuthorized || isRunning}
          >
            <DownloadIcon data-icon="inline-start" />
            Crash report
          </Button>
          <Button
            id="package-state-button"
            variant="outline"
            onClick={downloadPackageState}
            disabled={!isConnected || !sessionAuthorized || isRunning}
          >
            <DownloadIcon data-icon="inline-start" />
            Package state
          </Button>
          <Button
            id="transfer-check-button"
            variant="outline"
            onClick={runTransferCheck}
            disabled={!isConnected || !sessionAuthorized || isRunning}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Transfer check
          </Button>
          <Button
            variant="outline"
            onClick={forgetBrowser}
            disabled={!status?.device_id || isRunning}
          >
            Forget browser
          </Button>
        </div>

        {progress ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{progress.label}</span>
              <span className="font-mono">{progress.text}</span>
            </div>
            <Progress value={progress.percent} />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Action blocked</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Status</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Results</h2>
            <CopyButton
              label="Copy results"
              value={toDebugJson(results)}
              disabled={results.length === 0}
            />
          </div>
          <div className="rounded-md border">
            <Table className="min-w-[44rem] text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Bytes</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length > 0 ? (
                  results.map((result, index) => (
                    <TableRow key={`${result.action}-${result.kind}-${index}`}>
                      <TableCell>{result.action}</TableCell>
                      <TableCell>{result.kind}</TableCell>
                      <TableCell className="font-mono">
                        {result.name ?? "-"}
                      </TableCell>
                      <TableCell>{result.bytes}</TableCell>
                      <TableCell>{result.rate} B/s</TableCell>
                      <TableCell>
                        {result.error ?? result.finalState ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      No transfers yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Status</h2>
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

      <Separator />

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Event log</h2>
          <CopyButton
            label="Copy log"
            value={toDebugJson(events)}
            disabled={events.length === 0}
          />
        </div>
        <div className="max-h-80 overflow-auto rounded-md border">
          {events.length > 0 ? (
            <ol className="divide-y">
              {events.map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  data-event-at={event.at}
                  data-event-message={event.message}
                  data-event-type={event.type}
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
                  </div>
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

function useBrowserBluetoothSupport() {
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    setIsSupported(BleTransferBrowserClient.isSupported())
  }, [])

  return isSupported
}

function nowMs() {
  return performance.now()
}

function transferProgress(status: TransferStatus | null): {
  label: string
  percent: number
  text: string
} | null {
  if (!status?.state || typeof status.size !== "number" || status.size <= 0) {
    return null
  }

  const current =
    typeof status.received === "number"
      ? status.received
      : typeof status.sent === "number"
        ? status.sent
        : typeof status.written === "number"
          ? status.written
          : null

  if (current === null) return null

  const percent = Math.max(0, Math.min(100, (current / status.size) * 100))
  return {
    label: statusLabel(status.state),
    percent,
    text: `${current} / ${status.size} bytes`,
  }
}

function statusLabel(state: string): string {
  switch (state) {
    case "receiving":
      return "Receiving"
    case "sending":
      return "Sending"
    case "verifying":
      return "Verifying"
    case "updating":
      return "Updating"
    case "restarting":
      return "Restarting"
    default:
      return state
  }
}

function acceptForUploadKind(kind: UploadKind): string {
  return uploadSuffixForKind(kind)
}

function uploadKindLabel(kind: UploadKind): string {
  switch (kind) {
    case "package":
      return "Package"
    case "book":
      return "Book"
    case "bmp":
      return "BMP"
    case "firmware":
      return "Firmware"
  }
}

function createTransferCheckBmpName(): string {
  const runId = Date.now().toString(36)
  return `\u0413\u0440\u043e\u043a\u0430\u0435\u043c \u0430\u043b\u0433\u043e\u0440\u0438\u0442\u043c\u044b ${runId}.bmp`
}

function explainReaderError(
  error: string | undefined,
  fallback: string
): string {
  switch (error) {
    case "exists":
      return "A file with this transfer name already exists on the reader. Rename the file or remove the existing copy, then try again."
    case "session code required":
      return "Authorize this session first: enter the six-digit code or reconnect with a saved trusted browser."
    case "unsafe bmp filename":
      return "The BMP transfer name was rejected. Use letters, numbers, dots, underscores, or dashes, and keep the .bmp extension."
    case "unsafe book filename":
      return "The book transfer name was rejected. Use letters, numbers, dots, underscores, or dashes, and keep the .epub extension."
    case "unsafe package filename":
      return "The package transfer name was rejected. Use letters, numbers, dots, underscores, or dashes, and keep the .mpkg.zip extension."
    case undefined:
    case "":
      return fallback
    default:
      return error
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
      bytes[offset] = x & 0xff
      bytes[offset + 1] = y & 0xff
      bytes[offset + 2] = (x + y) & 0xff
    }
  }

  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function toDebugJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
