import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-5 px-5 py-8 text-sm">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-medium">BLE Xteink</h1>
        <p className="text-muted-foreground">
          Browser and native clients for the Xteink BLE transfer protocol.
        </p>
      </div>
      <div>
        <Button asChild>
          <Link href="/transfer">Open transfer</Link>
        </Button>
        <Button asChild variant="outline" className="ml-2">
          <Link href="/lab/connect">Open connect lab</Link>
        </Button>
        <Button asChild variant="outline" className="ml-2">
          <Link href="/lab/upload-sweep">Open upload sweep</Link>
        </Button>
      </div>
    </main>
  )
}
