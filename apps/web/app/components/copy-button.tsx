"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

type CopyState = "idle" | "copied" | "failed"

export function CopyButton({
  value,
  label,
  compactOnMobile = false,
  disabled = false,
  size = "sm",
  variant = "outline",
}: {
  value: string
  label: string
  compactOnMobile?: boolean
  disabled?: boolean
  size?: "xs" | "sm"
  variant?: "ghost" | "outline"
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

  if (compactOnMobile) {
    return (
      <>
        <Button
          type="button"
          variant={variant}
          size="icon"
          onClick={copy}
          disabled={disabled}
          aria-label={text}
          className="size-10 sm:hidden"
        >
          <Icon data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant={variant}
          size={size}
          onClick={copy}
          disabled={disabled}
          className="max-sm:hidden"
        >
          <Icon data-icon="inline-start" />
          {text}
        </Button>
      </>
    )
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      disabled={disabled}
    >
      <Icon data-icon="inline-start" />
      {text}
    </Button>
  )
}
