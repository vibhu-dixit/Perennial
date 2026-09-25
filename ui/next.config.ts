import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the repo root is shared by the Python loop and the UI.
loadEnvConfig(path.join(process.cwd(), ".."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
