import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ["@workspace/ui"],
}

export default nextConfig
