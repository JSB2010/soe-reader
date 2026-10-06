import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
assert.equal(
  existsSync(".next/standalone/.env.local"),
  false,
  "Local secrets must not enter the standalone package.",
);
assert.equal(
  existsSync(".next/standalone/.data"),
  false,
  "Local data must not enter the standalone package.",
);
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    APP_MODE: "cloud",
    APP_ORIGIN: "https://example.invalid",
    PORT: "3101",
    HOSTNAME: "127.0.0.1",
    GOOGLE_OAUTH_CLIENT_ID: "",
    GOOGLE_OAUTH_CLIENT_SECRET: "",
  },
  stdio: ["ignore", "ignore", "inherit"],
});
try {
  let ready = false;
  for (let n = 0; n < 30; n++) {
    try {
      const response = await fetch("http://127.0.0.1:3101/api/health");
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.mode, "cloud");
        assert.equal(health.authConfigured, false);
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(
    ready,
    "Packaged production server could not import its runtime dependencies.",
  );
  const owner = await fetch("http://127.0.0.1:3101/api/documents");
  assert.equal(
    owner.status,
    503,
    "Owner API must fail closed when OAuth is missing.",
  );
  console.log(
    "Packaged production server health and closed authentication passed.",
  );
} finally {
  server.kill("SIGTERM");
}
