import { SAFE_FILENAME_PATTERN, SAFE_PACKAGE_ID_PATTERN } from "./constants.js"
import type { UploadKind } from "./types.js"

const UPLOAD_SUFFIXES: Record<UploadKind, string> = {
  package: ".mpkg.zip",
  book: ".epub",
  bmp: ".bmp",
  firmware: ".bin",
}

export function isSafePackageId(value: string): boolean {
  return SAFE_PACKAGE_ID_PATTERN.test(value)
}

export function isSafeUploadName(value: string, kind: UploadKind): boolean {
  const suffix = uploadSuffixForKind(kind)
  if (!SAFE_FILENAME_PATTERN.test(value)) return false
  if (value.includes("/") || value.includes("\\")) return false
  if (value.startsWith(".")) return false
  return value.toLowerCase().endsWith(suffix)
}

export function uploadSuffixForKind(kind: UploadKind): string {
  switch (kind) {
    case "package":
      return UPLOAD_SUFFIXES.package
    case "book":
      return UPLOAD_SUFFIXES.book
    case "bmp":
      return UPLOAD_SUFFIXES.bmp
    case "firmware":
      return UPLOAD_SUFFIXES.firmware
  }
}
