import { strFromU8, unzipSync } from "fflate"

import { isSafePackageId } from "@workspace/ble-protocol"

export type PackageArchiveIdResult =
  | {
      ok: true
      packageId: string
      message: string
    }
  | {
      ok: false
      message: string
    }

export function extractPackageIdFromArchive(
  archiveBytes: Uint8Array
): PackageArchiveIdResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archiveBytes, {
      filter: (file) => file.name === "manifest.json",
    })
  } catch {
    return {
      ok: false,
      message:
        "Could not read package metadata. The archive may be damaged or not a Marginalia package.",
    }
  }

  const manifestBytes = files["manifest.json"]
  if (!manifestBytes) {
    return {
      ok: false,
      message:
        "Package metadata was not found. Choose a .mpkg.zip built by Marginalia tooling.",
    }
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(strFromU8(manifestBytes))
  } catch {
    return {
      ok: false,
      message: "Package metadata is not valid JSON.",
    }
  }

  if (!isRecord(manifest) || typeof manifest.id !== "string") {
    return {
      ok: false,
      message: "Package metadata does not contain a package id.",
    }
  }

  if (!isSafePackageId(manifest.id)) {
    return {
      ok: false,
      message:
        "Package metadata contains an id that is not safe for diagnostics.",
    }
  }

  return {
    ok: true,
    packageId: manifest.id,
    message: `Package id filled from metadata: ${manifest.id}.`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
