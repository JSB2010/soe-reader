import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { config } = await import("../lib/config");
const { extractPdf } = await import("../lib/extraction");
const { hashToken, makeToken } = await import("../lib/security");
const { putAsset } = await import("../lib/assets");
const { store } = await import("../lib/store");
const { enqueue } = await import("../lib/tasks");
const { pdfPath } = await import("../lib/model");
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  bold = await pdf.embedFont(StandardFonts.HelveticaBold);
function draw(
  page: ReturnType<typeof pdf.addPage>,
  text: string,
  x: number,
  y: number,
  size = 12,
  strong = false,
) {
  page.drawText(text, {
    x,
    y,
    size,
    font: strong ? bold : font,
    color: rgb(0.12, 0.14, 0.16),
  });
}
const first = pdf.addPage([612, 792]);
draw(first, "Reading & reasoning", 54, 730, 23, true);
draw(first, "Practice assessment | Digital PDF fixture", 54, 704, 11);
draw(
  first,
  "Directions: Click a question or answer choice to hear it.",
  54,
  656,
);
draw(
  first,
  "1. Dr. Rivera measures a circle with radius 3.14 cm. Read the",
  54,
  611,
);
draw(
  first,
  "question carefully, then choose the statement supported by the data.",
  54,
  594,
);
draw(first, "A. The radius is greater than 3 cm.", 70, 553);
draw(first, "B. The radius is exactly 3 cm.", 70, 529);
draw(first, "C. The radius is less than 3 cm.", 70, 505);
draw(first, "D. The diameter is less than the radius.", 70, 481);
draw(first, "2. Read the passage before answering.", 54, 430);
draw(
  first,
  "Rain fell overnight. By morning, the garden soil was damp.",
  54,
  402,
);
draw(
  first,
  "The students observed the garden and recorded their findings.",
  54,
  384,
);
draw(first, "A. The garden was dry in the morning.", 70, 343);
draw(first, "B. The soil was damp after rain.", 70, 319);
draw(first, "C. No one observed the garden.", 70, 295);
draw(
  first,
  "3. Check the literal equation in teacher preview: x^2 + 4 = 13.",
  54,
  239,
);
draw(first, "Read the passage before answering.", 54, 197);
draw(first, "Page 1 of 2", 54, 50, 10);
const second = pdf.addPage([612, 792]);
draw(second, "Two-column questions", 54, 730, 23, true);
const left = [
  "4. Which value is a decimal?",
  "A. 3.14",
  "B. 314",
  "C. 31",
  "D. 3",
  "Read the passage before answering.",
];
const right = [
  "5. Which claim uses evidence?",
  "A. Soil was damp after rain.",
  "B. Soil is always damp.",
  "C. Rain never falls.",
  "D. Gardens need no water.",
  "Read the passage before answering.",
];
left.forEach((line, i) => draw(second, line, 54, 650 - i * 33, 11));
right.forEach((line, i) => draw(second, line, 323, 650 - i * 33, 11));
draw(second, "Page 2 of 2", 54, 50, 10);
await mkdir("fixtures/audio", { recursive: true });
await mkdir("public", { recursive: true });
const bytes = Buffer.from(await pdf.save());
await writeFile("fixtures/assessment.pdf", bytes);
await writeFile("public/fixture.pdf", bytes);
const manifest = await extractPdf(bytes);
await writeFile(
  "fixtures/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const text of [
  ...new Set(manifest.segments.map((s) => s.text)),
  "Local mock audio. Cloud mode generates speech for the actual uploaded text.",
]) {
  const mock = text.startsWith("Local mock audio."),
    destination = join(
      "fixtures/audio",
      mock ? "mock.mp3" : `${hashToken(text)}.mp3`,
    );
  if (existsSync(destination)) continue;
  const temp = join("/private/tmp", `soe-fixture-${randomUUID()}.aiff`);
  execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", temp, text]);
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    temp,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    destination,
  ]);
  const { unlink } = await import("node:fs/promises");
  await unlink(temp);
}
if (config().local && !process.argv.includes("--assets-only")) {
  const token = makeToken(),
    now = Date.now();
  const doc = {
    id: randomUUID(),
    ownerId: "local-one",
    title: "Reading & reasoning · demo",
    version: randomUUID(),
    status: "queued" as const,
    enabled: true,
    availableAt: now - 60000,
    expiresAt: now + 86400000,
    timezone: config().timezone,
    voice: config().voices[0],
    createdAt: now,
    updatedAt: now,
    pdfBytes: bytes.length,
    tokenHash: token.hash,
    encryptedToken: token.encrypted,
    pages: 0,
    totalSegments: 0,
    completedSegments: 0,
    warnings: [],
    error: null,
    leaseId: null,
    leaseUntil: 0,
    attempts: 0,
    quotaReserved: false,
  };
  await store().create(doc);
  await putAsset(pdfPath(doc), bytes, "application/pdf");
  await enqueue({
    documentId: doc.id,
    version: doc.version,
    generation: randomUUID(),
  });
  console.log(
    "Demo assessment queued. Start npm run worker:local and npm run dev.",
  );
}
console.log(
  `Prepared fixture: ${manifest.pages.length} pages, ${manifest.segments.length} segments, matching prerecorded MP3s.`,
);
