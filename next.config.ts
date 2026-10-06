import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
const config = (phase: string): NextConfig => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  agentRules: false,
  output: "standalone",
  serverExternalPackages: [
    "pdfjs-dist",
    "@napi-rs/canvas",
    "@google-cloud/firestore",
    "@google-cloud/storage",
    "@google-cloud/tasks",
    "@google-cloud/text-to-speech",
    "google-auth-library",
  ],
  outputFileTracingIncludes: {
    "/api/*": [
      "node_modules/pdfjs-dist/**/*",
      "node_modules/@napi-rs/canvas*/**/*",
      "node_modules/@google-cloud/**/*",
      "node_modules/google-gax/**/*",
      "node_modules/google-auth-library/**/*",
      "node_modules/gcp-metadata/**/*",
      "node_modules/google-logging-utils/**/*",
      "node_modules/protobufjs/**/*",
      "node_modules/proto3-json-serializer/**/*",
      "node_modules/@grpc/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      ".data/**/*",
      ".env*",
      ".git/**/*",
      "test-results/**/*",
      ".next-dev/**/*",
    ],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cache-Control", value: "private, no-store" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${phase === PHASE_DEVELOPMENT_SERVER ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
          },
        ],
      },
    ];
  },
});
export default config;
