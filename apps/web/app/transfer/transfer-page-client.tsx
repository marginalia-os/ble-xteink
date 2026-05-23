"use client"

import dynamic from "next/dynamic"

const TransferClient = dynamic(
  () => import("./transfer-client").then((module) => module.TransferClient),
  {
    ssr: false,
    loading: () => (
      <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col justify-center px-5 py-6 text-sm">
        <p className="text-muted-foreground">Loading transfer...</p>
      </main>
    ),
  }
)

export function TransferPageClient() {
  return <TransferClient />
}
