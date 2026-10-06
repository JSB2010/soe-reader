import { randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
try {
  await access(".env.local");
  console.log(".env.local already exists; preserved.");
} catch {
  await writeFile(
    ".env.local",
    `APP_MODE=local\nAPP_ORIGIN=http://127.0.0.1:3000\nAPP_SECRET_KEY=${randomBytes(32).toString("base64")}\nDEFAULT_TIMEZONE=America/Denver\n`,
    { mode: 0o600 },
  );
  console.log("Created local-only configuration.");
}
