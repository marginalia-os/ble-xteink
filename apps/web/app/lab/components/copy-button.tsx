"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

type CopyState = "idle" | "copied" | "failed"

export function CopyButton({
  value,
  label,
  disabled = false,
  size = "sm",
}: {
  value: string
  label: string
  disabled?: boolean
  size?: "xs" | "sm"
}) {
  const [state, setState] = useState<CopyState>("idle")

  async function copy() {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setState("copied")
      window.setTimeout(() => setState("idle"), 1200)
    } catch {
      setState("failed")
      window.setTimeout(() => setState("idle"), 1600)
    }
  }

  const Icon = state === "copied" ? CheckIcon : CopyIcon
  const text =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={copy}
      disabled={disabled}
    >
      <Icon data-icon="inline-start" />
      {text}
    </Button>
  )
}
