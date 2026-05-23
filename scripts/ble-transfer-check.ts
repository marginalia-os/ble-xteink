import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import puppeteer, {
  type Browser,
  type Page,
  type ProtocolType,
} from "puppeteer-core"

type CheckMode = "transfer-check" | "diagnostics"
type AuthPath = "trusted" | "code" | "unauthorized"

interface TransferResult {
  action: string
  kind: string
  name: string
  bytes: string
  rate: string
  state: string
}

interface TransferEvent {
  at: string
  message: string
  type: string
}

interface RunContext {
  authPath: AuthPath
  browserGrant: {
    supported: boolean
    devices: string[]
  }
  chromeVersion?: string
  downloads?: DownloadRecord[]
  selectedDevice?: {
    id: string
    name: string
  }
}

interface DownloadRecord {
  guid: string
  receivedBytes: number
  state: string
  suggestedFilename: string
  totalBytes: number
}

interface DownloadTracker {
  records: Map<string, DownloadRecord>
  supported: boolean
  waitForCompleted(expectedCount: number, timeout: number): Promise<void>
}

const url = optionValue("--url") ?? "http://localhost:3000/transfer?dev=1"
const deviceName = optionValue("--device") ?? "Marginalia Transfer"
const pairCode = optionValue("--code")
const packageIdOption = optionValue("--package-id")
const packageFile = optionValue("--package-file")
const mode = modeOption()
const chromePath =
  optionValue("--chrome") ??
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const cdpEndpoint = optionValue("--cdp") ?? process.env.CHROME_CDP
const protocol = protocolOption()
const timeoutMs = numberOption("--timeout", 90_000)
const outputPath = optionValue("--output") ?? ".lab-reports/transfer-check.json"
const profileDir = optionValue("--profile") ?? ".lab-reports/chrome-profile"
const downloadDir = optionValue("--download-dir") ?? ".lab-reports/downloads"
const keepOpen = hasFlag("--keep-open")
const verboseEvents = hasFlag("--verbose-events")
const eventLimit = numberOption("--event-limit", 30)
const runContext: RunContext = {
  authPath: "unauthorized",
  browserGrant: { supported: false, devices: [] },
}
let diagnosticsPackageId = packageIdOption

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage()
    return
  }
  if (packageFile && !existsSync(packageFile)) {
    throw new Error(`Package file not found: ${packageFile}`)
  }

  const browser = await openBrowser()
  const page = await getPage(browser)
  runContext.chromeVersion = await browser.version().catch(() => undefined)
  const downloads = await configureDownloads(page)

  try {
    page.setDefaultTimeout(timeoutMs)
    await page.goto(url, { waitUntil: "networkidle2" })
    await configureReportExtraction(page)
    await connectToDevice(page)
    await authorizeSession(page)
    if (mode === "diagnostics") {
      await runDiagnostics(page)
      await waitForDiagnosticsDownloads(downloads)
    } else {
      await runTransferCheck(page)
    }

    const result =
      mode === "diagnostics"
        ? await readDiagnosticsResult(page)
        : await readTransferCheckResult(page)
    writeReport(result)
    console.log(JSON.stringify(result, null, 2))

    if (!keepOpen) await closeBrowser(browser)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await writeFailureReport(page, detail).catch(() => undefined)
    if (!keepOpen) await closeBrowser(browser).catch(() => undefined)
    console.error(detail)
    process.exitCode = 1
  }
}

async function closeBrowser(browser: Browser) {
  const close = browser.close()
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 10_000)
  )
  const result = await Promise.race([close, timeout])
  if (result === "timeout") {
    log("Chrome did not close within 10000ms; terminating browser process")
    browser.process()?.kill()
  }
}

async function configureDownloads(page: Page): Promise<DownloadTracker> {
  mkdirSync(downloadDir, { recursive: true })

  const records = new Map<string, DownloadRecord>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const tracker: DownloadTracker = {
    records,
    supported: false,
    waitForCompleted: (expectedCount, timeout) =>
      waitForCompletedDownloads(tracker, listeners, expectedCount, timeout),
  }

  try {
    const client = await page.createCDPSession()
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: join(process.cwd(), downloadDir),
      eventsEnabled: true,
    })
    client.on("Browser.downloadWillBegin", (event) => {
      records.set(event.guid, {
        guid: event.guid,
        receivedBytes: 0,
        state: "inProgress",
        suggestedFilename: event.suggestedFilename,
        totalBytes: 0,
      })
      notify()
    })
    client.on("Browser.downloadProgress", (event) => {
      const previous = records.get(event.guid)
      records.set(event.guid, {
        guid: event.guid,
        receivedBytes: event.receivedBytes,
        state: event.state,
        suggestedFilename: previous?.suggestedFilename ?? event.guid,
        totalBytes: event.totalBytes,
      })
      notify()
    })
    tracker.supported = true
    log(`Chrome downloads will be saved to ${downloadDir}`)
  } catch (error) {
    log(
      `Chrome download tracking is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return tracker
}

async function waitForCompletedDownloads(
  tracker: DownloadTracker,
  listeners: Set<() => void>,
  expectedCount: number,
  timeout: number
) {
  if (expectedCount <= 0) return
  if (!tracker.supported) {
    throw new Error(
      "Diagnostics completed in the page, but Chrome download tracking is unavailable."
    )
  }

  const hasEnoughCompleted = () =>
    Array.from(tracker.records.values()).filter(
      (record) => record.state === "completed"
    ).length >= expectedCount

  if (hasEnoughCompleted()) return

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(listener)
      reject(
        new Error(
          `Timed out waiting for ${expectedCount} Chrome download(s) to complete. Current downloads: ${JSON.stringify(
            Array.from(tracker.records.values())
          )}`
        )
      )
    }, timeout)
    const listener = () => {
      if (!hasEnoughCompleted()) return
      clearTimeout(timer)
      listeners.delete(listener)
      resolve()
    }
    listeners.add(listener)
  })
}

async function openBrowser(): Promise<Browser> {
  if (cdpEndpoint) {
    return puppeteer.connect({
      browserURL: cdpEndpoint,
      defaultViewport: null,
    })
  }

  if (!existsSync(chromePath)) {
    throw new Error(
      `Chrome executable not found at ${chromePath}. Pass --chrome /path/to/Chrome or set CHROME_PATH.`
    )
  }

  return puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    protocol,
    userDataDir: profileDir,
    args: ["--enable-features=WebBluetooth"],
  })
}

async function getPage(browser: Browser): Promise<Page> {
  const pages = await browser.pages()
  return pages[0] ?? (await browser.newPage())
}

async function connectToDevice(page: Page) {
  const connectDisabled = await buttonDisabled(page, "Connect")
  if (connectDisabled) return

  const browserGrant = await page.evaluate(async () => {
    const bluetooth = navigator.bluetooth
    if (!bluetooth?.getDevices) {
      return { supported: false, devices: [] as string[] }
    }
    const devices = await bluetooth.getDevices()
    return {
      supported: true,
      devices: devices.map((device) => device.name ?? "(unnamed)"),
    }
  })
  runContext.browserGrant = browserGrant
  log(
    `Known Web Bluetooth grants: ${
      browserGrant.supported
        ? browserGrant.devices.join(", ") || "none"
        : "unsupported"
    }`
  )

  log("Connecting to BLE device")
  const promptTimeout = Math.min(timeoutMs, 10_000)
  const promptSelection = page
    .waitForDevicePrompt({ timeout: promptTimeout })
    .then(async (prompt) => {
      log("Bluetooth chooser opened")

      const device = await prompt.waitForDevice(
        (candidate) => {
          log(`Discovered BLE device: ${candidate.name} (${candidate.id})`)
          return candidate.name.includes(deviceName)
        },
        { timeout: timeoutMs }
      )
      log(`Selecting BLE device: ${device.name} (${device.id})`)
      runContext.selectedDevice = {
        id: device.id,
        name: device.name,
      }
      await prompt.select(device)
      return "selected"
    })
    .catch((error) => {
      log(
        `Puppeteer did not receive a Bluetooth chooser event: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return "prompt-unavailable"
    })

  await clickButton(page, "Connect")

  const promptOutcome = await Promise.race([
    promptSelection,
    waitForConnected(page, Math.min(timeoutMs, 15_000)).then((connected) =>
      connected ? "connected" : "not-connected"
    ),
  ])
  if (promptOutcome === "connected") return
  if (promptOutcome === "selected") {
    const connectedAfterSelect = await waitForConnected(page, 15_000)
    if (connectedAfterSelect) return
    throw new Error(
      "Selected the BLE device, but Chrome did not complete the GATT connection. Reopen Bluetooth Transfer on the reader and rerun the check."
    )
  }

  const connectedAfterPromptTimeout = await waitForConnected(page, 15_000)
  if (connectedAfterPromptTimeout) return

  throw new Error(
    "Connection failed before GATT setup: Chrome did not expose a selectable Web Bluetooth device and the page did not reconnect through a previously allowed device. Reopen Bluetooth Transfer on the reader, keep the reader advertising, and rerun the check."
  )
}

async function authorizeSession(page: Page) {
  const trusted = await waitForText(page, "Trusted browser connected.", 8_000)
  if (trusted) {
    runContext.authPath = "trusted"
    return
  }

  if (pairCode) {
    log("Trusted auth not available; sending provided pairing code")
    await page.locator("#visible-code").fill(pairCode)
    await clickButton(page, "Save")
    const authorized = await waitForTransferCheckEnabled(page, timeoutMs)
    if (authorized) {
      runContext.authPath = "code"
      return
    }
    throw new Error(
      "Pairing code was sent, but the browser was not authorized before timeout. Check the reader confirmation prompt and rerun with the current six-digit code."
    )
  }

  const snapshot = await page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
      (element) => element.textContent?.trim() ?? ""
    ),
    status: document.querySelector("pre")?.textContent ?? "",
  }))
  throw new Error(
    `Trusted auth failed: this automation profile does not have an accepted trusted-host record. Run once with --code <six digits> and confirm save-browser on the reader. Current page: ${JSON.stringify(
      snapshot
    )}`
  )
}

async function runTransferCheck(page: Page) {
  await clickButton(page, "Transfer check")
  await page.waitForFunction(
    () => document.body.innerText.includes("Transfer check finished"),
    { timeout: timeoutMs }
  )
}

async function runDiagnostics(page: Page) {
  if (packageFile) {
    await uploadPackageFile(page, packageFile)
  }

  await clickButton(page, "Crash report")
  await waitForResultRow(page, "download", "crash_report", timeoutMs, "sent")

  if (!diagnosticsPackageId) {
    await expectButtonDisabled(page, "Package state")
    return
  }

  await page.locator("#package-id").fill(diagnosticsPackageId)
  await expectButtonEnabled(page, "Package state")
  await clickButton(page, "Package state")
  await waitForResultRow(page, "download", "package_state", timeoutMs, "sent")
}

async function uploadPackageFile(page: Page, path: string) {
  const absolutePath = resolve(path)
  log(`Uploading package file: ${absolutePath}`)
  const input = await page.$("#upload-file")
  if (!input) throw new Error("Upload file input was not found.")
  await input.uploadFile(absolutePath)
  await page.waitForFunction(
    () =>
      Boolean(
        (document.querySelector("#package-id") as HTMLInputElement).value
      ),
    { timeout: timeoutMs }
  )
  diagnosticsPackageId = await page.$eval(
    "#package-id",
    (input) => (input as HTMLInputElement).value
  )
  log(`Package id from selected archive: ${diagnosticsPackageId}`)
  await expectButtonEnabled(page, "Upload")
  await clickButton(page, "Upload")
  await waitForResultRow(page, "upload", "package", timeoutMs, [
    "saved",
    "installed",
  ])
}

async function waitForDiagnosticsDownloads(downloads: DownloadTracker) {
  const expectedCount = diagnosticsPackageId ? 2 : 1
  await downloads.waitForCompleted(expectedCount, timeoutMs)
  const completed = Array.from(downloads.records.values()).filter(
    (record) => record.state === "completed"
  )
  runContext.downloads = completed
  log(
    `Completed Chrome downloads: ${completed
      .map((record) => record.suggestedFilename)
      .join(", ")}`
  )
}

async function readTransferCheckResult(page: Page) {
  const result = await readPageReport(page)
  const upload = result.rows.find((row) => row.action === "upload")
  const download = result.rows.find((row) => row.action === "download")
  const failures = result.rows.filter(
    (row) => row.state !== "saved" && row.state !== "sent"
  )

  if (!upload || !download || failures.length > 0) {
    throw new Error(`Transfer check failed: ${JSON.stringify(result.rows)}`)
  }

  return {
    ok: true,
    at: new Date().toISOString(),
    meta: reportMeta(),
    ...result,
  }
}

async function readDiagnosticsResult(page: Page) {
  const result = await readPageReport(page)
  const crashReport = result.rows.find(
    (row) => row.action === "download" && row.kind === "crash_report"
  )
  const packageState = result.rows.find(
    (row) => row.action === "download" && row.kind === "package_state"
  )
  const failures = result.rows.filter((row) =>
    row.action === "upload"
      ? row.state !== "saved" && row.state !== "installed"
      : row.state !== "sent"
  )

  if (!crashReport || failures.length > 0) {
    throw new Error(`Diagnostics check failed: ${JSON.stringify(result.rows)}`)
  }
  if (diagnosticsPackageId && !packageState) {
    throw new Error(
      `Package-state diagnostics did not produce a result for ${diagnosticsPackageId}.`
    )
  }

  return {
    ok: true,
    at: new Date().toISOString(),
    meta: reportMeta(),
    diagnostics: {
      crashReport: "passed",
      packageState: diagnosticsPackageId
        ? "passed"
        : "skipped: no package id supplied",
    },
    ...result,
  }
}

async function readPageReport(page: Page) {
  return page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(
      (element) => element.textContent?.trim() ?? ""
    )
    const rows = Array.from(document.querySelectorAll("tbody tr"))
      .map((row) =>
        Array.from(row.querySelectorAll("td")).map(
          (cell) => cell.textContent?.trim() ?? ""
        )
      )
      .filter((row) => row.length === 6)
      .map(
        ([action, kind, name, bytes, rate, state]) =>
          ({ action, kind, name, bytes, rate, state }) satisfies TransferResult
      )
    const status = document.querySelector("pre")?.textContent ?? ""
    const overflow =
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
    const events = Array.from(document.querySelectorAll("[data-event-type]"))
      .map((element) => ({
        at: element.getAttribute("data-event-at") ?? "",
        message: element.getAttribute("data-event-message") ?? "",
        type: element.getAttribute("data-event-type") ?? "",
      }))
      .filter((event): event is TransferEvent =>
        Boolean(event.at && event.message && event.type)
      )
    const eventLimitRaw = document.documentElement.dataset.reportEventLimit
    const eventLimit = Number.parseInt(eventLimitRaw ?? "", 10)
    const limitedEvents =
      Number.isFinite(eventLimit) && eventLimit > 0
        ? events.slice(0, eventLimit)
        : events

    return { alerts, events: limitedEvents, rows, status, overflow }
  })
}

async function writeFailureReport(page: Page, error: string) {
  const result = await page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
      (element) => element.textContent?.trim() ?? ""
    ),
    bodyText: document.body.innerText,
  }))

  writeReport({
    ok: false,
    at: new Date().toISOString(),
    meta: reportMeta(),
    error,
    ...result,
  })
}

function reportMeta() {
  return {
    authPath: runContext.authPath,
    browserGrant: runContext.browserGrant,
    chromeVersion: runContext.chromeVersion,
    cdpEndpoint: cdpEndpoint ?? null,
    deviceName,
    downloadDir: mode === "diagnostics" ? downloadDir : null,
    downloads: runContext.downloads ?? [],
    mode,
    packageFile: packageFile ? resolve(packageFile) : null,
    packageId: diagnosticsPackageId ?? null,
    profileDir: cdpEndpoint ? null : profileDir,
    protocol,
    reportEvents: verboseEvents ? "all" : eventLimit,
    selectedDevice: runContext.selectedDevice ?? null,
    url,
  }
}

function writeReport(value: unknown) {
  const directory = outputPath.includes("/")
    ? outputPath.slice(0, outputPath.lastIndexOf("/"))
    : "."
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(process.cwd(), outputPath),
    `${JSON.stringify(value, null, 2)}\n`
  )
}

async function clickButton(page: Page, name: string) {
  const selectors: Record<string, string> = {
    Connect: "#connect-button",
    "Crash report": "#crash-report-button",
    "Package state": "#package-state-button",
    Save: "#save-code-button",
    "Transfer check": "#transfer-check-button",
    Upload: "#upload-button",
  }
  const selector = selectors[name]
  if (selector) {
    await page.locator(selector).click()
    return
  }
  await page.locator(`::-p-aria(${name})`).click()
}

async function configureReportExtraction(page: Page) {
  await page.evaluate(
    (limit) => {
      document.documentElement.dataset.reportEventLimit = limit
    },
    verboseEvents ? "all" : String(eventLimit)
  )
}

async function waitForText(
  page: Page,
  text: string,
  timeout: number
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (expectedText) => document.body.innerText.includes(expectedText),
      { timeout },
      text
    )
    return true
  } catch {
    return false
  }
}

async function waitForTransferCheckEnabled(
  page: Page,
  timeout: number
): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === "Transfer check"
        )
        return Boolean(button && !button.disabled)
      },
      { timeout }
    )
    return true
  } catch {
    return false
  }
}

async function waitForConnected(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const readStatus = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === "Read status"
        )
        return Boolean(readStatus && !readStatus.disabled)
      },
      { timeout }
    )
    return true
  } catch {
    return false
  }
}

async function waitForResultRow(
  page: Page,
  action: string,
  kind: string,
  timeout: number,
  states?: string | string[]
) {
  const expectedStates = Array.isArray(states) ? states : states ? [states] : []
  await page.waitForFunction(
    (expectedAction, expectedKind, expectedStates) =>
      Array.from(document.querySelectorAll("tbody tr")).some((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map(
          (cell) => cell.textContent?.trim() ?? ""
        )
        return (
          cells[0] === expectedAction &&
          cells[1] === expectedKind &&
          (expectedStates.length === 0 || expectedStates.includes(cells[5]))
        )
      }),
    { timeout },
    action,
    kind,
    expectedStates
  )
}

async function buttonDisabled(page: Page, name: string): Promise<boolean> {
  return page.evaluate((buttonName) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === buttonName
    )
    return Boolean(button?.disabled)
  }, name)
}

async function expectButtonDisabled(page: Page, name: string) {
  const disabled = await buttonDisabled(page, name)
  if (!disabled) {
    throw new Error(
      `${name} should be disabled before required input is valid.`
    )
  }
}

async function expectButtonEnabled(page: Page, name: string) {
  const disabled = await buttonDisabled(page, name)
  if (disabled) {
    throw new Error(
      `${name} stayed disabled after required input was provided.`
    )
  }
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function numberOption(name: string, fallback: number): number {
  const value = optionValue(name)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function modeOption(): CheckMode {
  const value = optionValue("--mode")
  if (!value || value === "transfer-check") return "transfer-check"
  if (value === "diagnostics") return "diagnostics"
  throw new Error(
    `Unsupported --mode ${value}. Use "transfer-check" or "diagnostics".`
  )
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function protocolOption(): ProtocolType {
  const value = optionValue("--protocol")
  if (value === "cdp" || value === "webDriverBiDi") return value
  return "cdp"
}

function log(message: string) {
  console.error(`[ble-transfer-check] ${message}`)
}

function printUsage() {
  console.log(`Usage: bun run hardware:transfer-check -- [options]

Options:
  --url <url>        Transfer page URL. Default: http://localhost:3000/transfer?dev=1
  --device <name>    Device name substring. Default: Marginalia Transfer
  --mode <name>      transfer-check or diagnostics. Default: transfer-check.
  --package-id <id>  Optional package id for diagnostics package-state download.
  --package-file <path>
                    Optional .mpkg.zip to upload before package-state diagnostics.
  --code <digits>    Six-digit first-time pairing code.
  --chrome <path>    Chrome executable path. Defaults to macOS Google Chrome.
  --cdp <url>        Attach to an existing Chrome CDP endpoint instead of launching.
  --protocol <name>  Puppeteer launch protocol: cdp or webDriverBiDi. Default: cdp.
  --timeout <ms>     Operation timeout. Default: 90000
  --output <path>    JSON report path. Default: .lab-reports/transfer-check.json
  --profile <path>   Persistent Chrome profile. Default: .lab-reports/chrome-profile
  --download-dir <path>
                    Diagnostics download directory. Default: .lab-reports/downloads
  --event-limit <n>  Number of recent UI events in the JSON report. Default: 30.
  --verbose-events   Include all UI events in the JSON report.
  --keep-open        Leave Chrome open after the run.
  --help             Show this message.

The script auto-selects the real BLE device through Chrome CDP. Trusted-browser
auth is automatic after the first saved pairing in this profile. First pairing
can be bootstrapped with --code, but the reader still requires physical
confirmation to save the browser.`)
}

await main()
