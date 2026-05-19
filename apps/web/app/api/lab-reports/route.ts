import { mkdir, appendFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body: unknown = await request.json()
  const reportDir = join(process.cwd(), "..", "..", ".lab-reports")
  const reportPath = join(reportDir, "ble-download.jsonl")
  await mkdir(reportDir, { recursive: true })
  await appendFile(
    reportPath,
    `${JSON.stringify({ at: new Date().toISOString(), body })}\n`,
    "utf8"
  )

  return NextResponse.json({ ok: true })
}
