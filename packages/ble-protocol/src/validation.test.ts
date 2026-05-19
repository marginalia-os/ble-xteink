import { describe, expect, it } from "vitest"

import {
  inferUploadKindFromName,
  isSafePackageId,
  isSafeUploadName,
  repairUploadName,
  uploadSuffixForKind,
} from "./validation"

describe("validation helpers", () => {
  it("keeps package ids in the allowlisted shape", () => {
    expect(isSafePackageId("org.example.package")).toBe(true)
    expect(isSafePackageId("1_example-package")).toBe(true)
    expect(isSafePackageId(".hidden")).toBe(false)
    expect(isSafePackageId("a")).toBe(false)
  })

  it("validates upload names by kind", () => {
    expect(isSafeUploadName("reader.mpkg.zip", "package")).toBe(true)
    expect(isSafeUploadName("book.epub", "book")).toBe(true)
    expect(isSafeUploadName("image.bmp", "bmp")).toBe(true)
    expect(isSafeUploadName("firmware.bin", "firmware")).toBe(true)

    expect(isSafeUploadName("../book.epub", "book")).toBe(false)
    expect(isSafeUploadName(".hidden.epub", "book")).toBe(false)
    expect(isSafeUploadName("book.txt", "book")).toBe(false)
  })

  it("maps upload kinds to expected suffixes", () => {
    expect(uploadSuffixForKind("package")).toBe(".mpkg.zip")
    expect(uploadSuffixForKind("book")).toBe(".epub")
    expect(uploadSuffixForKind("bmp")).toBe(".bmp")
    expect(uploadSuffixForKind("firmware")).toBe(".bin")
  })

  it("infers upload kind from known suffixes", () => {
    expect(inferUploadKindFromName("reader.mpkg.zip")).toBe("package")
    expect(inferUploadKindFromName("Book.EPUB")).toBe("book")
    expect(inferUploadKindFromName("image.bmp")).toBe("bmp")
    expect(inferUploadKindFromName("firmware.bin")).toBe("firmware")
    expect(inferUploadKindFromName("avatar.png")).toBeNull()
  })

  it("repairs unsafe upload basenames without changing the kind suffix", () => {
    expect(repairUploadName("My Book!.epub", "book")).toMatchObject({
      reason: "repaired-basename",
      safeName: "My-Book.epub",
    })
    expect(repairUploadName("Грокаем алгоритмы.epub", "book")).toMatchObject({
      reason: "repaired-basename",
      safeName: "Grokaem-algoritmy.epub",
    })
  })

  it("does not repair mismatched upload extensions", () => {
    const repair = repairUploadName("avatar.png", "bmp")
    expect(repair).toMatchObject({ reason: "wrong-extension" })
    expect(repair).not.toHaveProperty("safeName")
  })
})
