import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"

import { extractPackageIdFromArchive } from "./package-archive"

describe("package archive metadata", () => {
  it("extracts a safe package id from manifest.json", () => {
    const archive = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          id: "org.marginalia.examples.dark-mode",
          version: "1.0.0",
        })
      ),
    })

    expect(extractPackageIdFromArchive(archive)).toMatchObject({
      ok: true,
      packageId: "org.marginalia.examples.dark-mode",
    })
  })

  it("rejects archives without package metadata", () => {
    const archive = zipSync({
      "README.md": strToU8("not a package"),
    })

    expect(extractPackageIdFromArchive(archive)).toMatchObject({
      ok: false,
    })
  })

  it("rejects unsafe package ids", () => {
    const archive = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          id: "../unsafe",
          version: "1.0.0",
        })
      ),
    })

    expect(extractPackageIdFromArchive(archive)).toMatchObject({
      ok: false,
    })
  })
})
