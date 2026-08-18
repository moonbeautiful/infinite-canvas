import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseChangelog } from "@/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const releases = parseChangelog(localChangelog);

    return {
        output: "standalone",
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        async redirects() {
            return [
                { source: "/", destination: "/product-suite", permanent: false },
                { source: "/canvas", destination: "/product-suite", permanent: false },
                { source: "/canvas/:path*", destination: "/product-suite", permanent: false },
                { source: "/image", destination: "/product-suite", permanent: false },
                { source: "/video", destination: "/product-suite", permanent: false },
                { source: "/prompts", destination: "/product-suite", permanent: false },
                { source: "/assets", destination: "/product-suite", permanent: false },
                { source: "/asset-library", destination: "/product-suite", permanent: false },
                { source: "/workflows", destination: "/product-suite", permanent: false },
            ];
        },
        typescript: {
            ignoreBuildErrors: true,
        },
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
    };
}
