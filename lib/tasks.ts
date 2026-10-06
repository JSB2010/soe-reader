import { CloudTasksClient } from "@google-cloud/tasks";
import { hashToken } from "./security";
import { config } from "./config";
import { database } from "./store";
import type { Task } from "./model";
let client: CloudTasksClient | undefined;
export async function enqueue(task: Task, cursor = 0) {
  const cfg = config(),
    id = hashToken(
      `${task.documentId}:${task.version}:${task.generation}:${cursor}`,
    );
  if (cfg.local) {
    database()
      .prepare("INSERT OR IGNORE INTO tasks(id,data,available) VALUES (?,?,?)")
      .run(id, JSON.stringify(task), Date.now());
    return;
  }
  if (!cfg.workerUrl || !cfg.taskAccount)
    throw new Error("Worker queue configuration missing.");
  client ||= new CloudTasksClient();
  const parent = client.queuePath(cfg.project, cfg.region, cfg.queue);
  try {
    await client.createTask({
      parent,
      task: {
        name: `${parent}/tasks/${id}`,
        dispatchDeadline: { seconds: 240 },
        httpRequest: {
          httpMethod: "POST",
          url: `${cfg.workerUrl}/api/tasks/process`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(task)).toString("base64"),
          oidcToken: {
            serviceAccountEmail: cfg.taskAccount,
            audience: cfg.workerUrl,
          },
        },
      },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) throw e;
  }
}
