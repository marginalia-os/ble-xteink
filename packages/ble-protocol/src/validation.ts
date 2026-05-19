import { SAFE_FILENAME_PATTERN, SAFE_PACKAGE_ID_PATTERN } from "./constants"
import type { UploadKind } from "./types"

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

export function inferUploadKindFromName(value: string): UploadKind | null {
  const normalized = value.trim().toLowerCase()
  if (normalized.endsWith(UPLOAD_SUFFIXES.package)) return "package"
  if (normalized.endsWith(UPLOAD_SUFFIXES.book)) return "book"
  if (normalized.endsWith(UPLOAD_SUFFIXES.bmp)) return "bmp"
  if (normalized.endsWith(UPLOAD_SUFFIXES.firmware)) return "firmware"
  return null
}

export interface UploadNameRepair {
  reason:
    | "already-safe"
    | "repaired-basename"
    | "wrong-extension"
    | "empty-name"
  safeName?: string
  message: string
}

export interface PackageIdRepair {
  reason: "already-safe" | "trimmed" | "empty" | "invalid"
  safeId?: string
  message: string
}

export function repairUploadName(
  value: string,
  kind: UploadKind
): UploadNameRepair {
  const suffix = uploadSuffixForKind(kind)
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      reason: "empty-name",
      message: `Choose a ${suffix} file.`,
    }
  }

  if (isSafeUploadName(trimmed, kind)) {
    return {
      reason: "already-safe",
      safeName: trimmed,
      message: "Filename is ready to upload.",
    }
  }

  if (!trimmed.toLowerCase().endsWith(suffix)) {
    const extension = extensionLabel(trimmed)
    return {
      reason: "wrong-extension",
      message: extension
        ? `Selected kind expects ${suffix}, but this file ends in ${extension}. Choose a ${suffix} file or change Upload kind.`
        : `Selected kind expects ${suffix}. Choose a ${suffix} file or change Upload kind.`,
    }
  }

  const basename = trimmed.slice(0, trimmed.length - suffix.length)
  const safeBase = sanitizeUploadBasename(basename, kind, suffix)
  return {
    reason: "repaired-basename",
    safeName: `${safeBase}${suffix}`,
    message: `Uploading as ${safeBase}${suffix}. The original file on your computer is unchanged.`,
  }
}

export function repairPackageId(value: string): PackageIdRepair {
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      reason: "empty",
      message:
        "Enter the package id to download its package-state diagnostics.",
    }
  }

  if (isSafePackageId(trimmed)) {
    if (trimmed === value) {
      return {
        reason: "already-safe",
        safeId: trimmed,
        message: "Package id is ready.",
      }
    }

    return {
      reason: "trimmed",
      safeId: trimmed,
      message: `Using ${trimmed}. Leading and trailing spaces were ignored.`,
    }
  }

  return {
    reason: "invalid",
    message:
      "Package id must be 2-96 characters, start with a letter or number, and use only letters, numbers, dots, underscores, or dashes.",
  }
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

function sanitizeUploadBasename(
  value: string,
  kind: UploadKind,
  suffix: string
): string {
  const normalized = transliterateBasic(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
  const replaced = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "")

  const fallback = kind === "book" ? "book" : kind
  const base = replaced || `${fallback}-${shortStableHash(value)}`
  return base.slice(0, 96 - suffix.length)
}

function extensionLabel(value: string): string | null {
  const lastDot = value.lastIndexOf(".")
  if (lastDot < 0 || lastDot === value.length - 1) return null
  return value.slice(lastDot).toLowerCase()
}

function shortStableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function transliterateBasic(value: string): string {
  return Array.from(
    value,
    (char) => CYRILLIC_TRANSLITERATION[char] ?? char
  ).join("")
}

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  А: "A",
  а: "a",
  Б: "B",
  б: "b",
  В: "V",
  в: "v",
  Г: "G",
  г: "g",
  Д: "D",
  д: "d",
  Е: "E",
  е: "e",
  Ё: "E",
  ё: "e",
  Ж: "Zh",
  ж: "zh",
  З: "Z",
  з: "z",
  И: "I",
  и: "i",
  Й: "Y",
  й: "y",
  К: "K",
  к: "k",
  Л: "L",
  л: "l",
  М: "M",
  м: "m",
  Н: "N",
  н: "n",
  О: "O",
  о: "o",
  П: "P",
  п: "p",
  Р: "R",
  р: "r",
  С: "S",
  с: "s",
  Т: "T",
  т: "t",
  У: "U",
  у: "u",
  Ф: "F",
  ф: "f",
  Х: "Kh",
  х: "kh",
  Ц: "Ts",
  ц: "ts",
  Ч: "Ch",
  ч: "ch",
  Ш: "Sh",
  ш: "sh",
  Щ: "Sch",
  щ: "sch",
  Ъ: "",
  ъ: "",
  Ы: "Y",
  ы: "y",
  Ь: "",
  ь: "",
  Э: "E",
  э: "e",
  Ю: "Yu",
  ю: "yu",
  Я: "Ya",
  я: "ya",
}
