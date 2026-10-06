import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { config } = await import("../lib/config");
if (!config().local)
  throw new Error("This worker requires explicit APP_MODE=local.");
const { takeLocalTask, database } = await import("../lib/store");
const { processTask } = await import("../lib/worker");
let alive = true;
process.on("SIGINT", () => {
  alive = false;
});
process.on("SIGTERM", () => {
  alive = false;
});
console.log(
  "Local durable worker ready. This process must stay running to process uploads.",
);
while (alive) {
  const entry = takeLocalTask();
  if (!entry) {
    await new Promise((r) => setTimeout(r, 500));
    continue;
  }
  try {
    await processTask(entry.task);
    database().prepare("DELETE FROM tasks WHERE id=?").run(entry.id);
  } catch {
    database()
      .prepare("UPDATE tasks SET available=? WHERE id=?")
      .run(Date.now() + Math.min(60000, entry.attempts * 2000), entry.id);
    console.log("A local task was checkpointed and will retry.");
  }
}
