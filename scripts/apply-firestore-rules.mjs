import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const { PROJECT_ID, GCP_ACCOUNT } = process.env;
if (!PROJECT_ID || !GCP_ACCOUNT)
  throw new Error("Set PROJECT_ID and GCP_ACCOUNT.");
const token = execFileSync(
  "gcloud",
  [
    "auth",
    "print-access-token",
    `--account=${GCP_ACCOUNT}`,
    `--project=${PROJECT_ID}`,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
).trim();
const base = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-Goog-User-Project": PROJECT_ID,
};
const created = await fetch(base + "/rulesets", {
  method: "POST",
  headers,
  body: JSON.stringify({
    source: {
      files: [
        {
          name: "firestore.rules",
          content: await readFile("firestore.rules", "utf8"),
        },
      ],
    },
  }),
});
if (!created.ok) {
  const error = await created.json();
  throw new Error(
    `Ruleset creation failed (${created.status}): ${error.error?.message || "API rejected request"}`,
  );
}
const rules = await created.json(),
  release = {
    name: `projects/${PROJECT_ID}/releases/cloud.firestore`,
    rulesetName: rules.name,
  };
let response = await fetch(base + "/releases/cloud.firestore", {
  method: "PATCH",
  headers,
  body: JSON.stringify({ release, updateMask: "rulesetName" }),
});
if (response.status === 404)
  response = await fetch(base + "/releases", {
    method: "POST",
    headers,
    body: JSON.stringify(release),
  });
if (!response.ok) throw new Error(`Rules release failed (${response.status}).`);
console.log(
  "Applied deny-all Firestore browser rules. Server SDKs still require IAM and application ownership checks.",
);
