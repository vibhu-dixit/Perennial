import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the repo root is shared by the Python loop and the UI. forceReload: Next has already
// loaded env from ui/ by the time this runs, and would otherwise return that cached result.
loadEnvConfig(path.join(process.cwd(), ".."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
