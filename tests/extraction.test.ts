import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, degrees, PDFHexString } from "pdf-lib";
import { extractPdf, splitUtf8, itemRect } from "../lib/extraction";
import { viewportRect } from "../lib/geometry";
import { testConfig } from "./helpers";
testConfig();
test("real assessment preserves wrapped questions, choices, repeats, decimals and column order", async () => {
  const manifest = await extractPdf(await readFile("fixtures/assessment.pdf"));
  assert.equal(manifest.pages.length, 2);
  const question = manifest.segments.find((s) =>
    s.text.startsWith("1. Dr. Rivera"),
  )!;
  assert.match(question.text, /3\.14/);
  assert.match(question.text, /question carefully/);
  assert.equal(question.rects.length, 2);
  for (const letter of ["A", "B", "C", "D"])
    assert.ok(manifest.segments.some((s) => s.text.startsWith(`${letter}.`)));
  assert.ok(
    manifest.segments.filter((s) =>
      s.text.includes("Read the passage before answering."),
    ).length >= 4,
  );
  const second = manifest.segments
    .filter((s) => s.page === 2)
    .map((s) => s.text);
  assert.ok(
    second.findIndex((s) => s.startsWith("D. 3")) <
      second.findIndex((s) => s.startsWith("5. Which")),
  );
  assert.deepEqual(
    manifest,
    await extractPdf(await readFile("fixtures/assessment.pdf")),
  );
});
test("UTF-8 synthesis chunks respect byte limits including multibyte characters", () => {
  const text = "é 中 🚀 ".repeat(2000),
    chunks = splitUtf8(text);
  assert.ok(chunks.length > 1);
  chunks.forEach((chunk) => assert.ok(Buffer.byteLength(chunk) <= 4800));
  assert.equal(chunks.join(" ").replace(/\s/g, ""), text.replace(/\s/g, ""));
  splitUtf8("中".repeat(6000)).forEach((chunk) =>
    assert.ok(Buffer.byteLength(chunk) <= 4800),
  );
});
test("malformed, scanned, and partially unreadable PDFs fail with an actionable result", async () => {
  await assert.rejects(
    () => extractPdf(Buffer.from("%PDF-1.7\ninvalid")),
    /could not be parsed/,
  );
  const blank = await PDFDocument.create();
  blank.addPage();
  const blankBytes = Buffer.from(await blank.save());
  await assert.rejects(() => extractPdf(blankBytes), /no readable text/);
  const partial = await PDFDocument.create(),
    font = await partial.embedFont(StandardFonts.Helvetica);
  partial.addPage().drawText("Readable first page.", { font });
  partial.addPage();
  const partialBytes = Buffer.from(await partial.save());
  await assert.rejects(() => extractPdf(partialBytes), /Page 2/);
});
test("PDF geometry remains aligned across zoom, 90/180/270 rotations and density", () => {
  const rect: [number, number, number, number] = [10, 20, 110, 32];
  assert.deepEqual(
    viewportRect(rect, [1, 0, 0, -1, 0, 792]),
    [10, 760, 110, 772],
  );
  assert.deepEqual(
    viewportRect(rect, [2, 0, 0, -2, 0, 1584]),
    [20, 1520, 220, 1544],
  );
  assert.deepEqual(viewportRect(rect, [0, 1, 1, 0, 0, 0]), [20, 10, 32, 110]);
  assert.deepEqual(
    viewportRect(rect, [-1, 0, 0, 1, 612, 0]),
    [502, 20, 602, 32],
  );
  assert.deepEqual(
    viewportRect(rect, [0, -1, -1, 0, 792, 612]),
    [760, 502, 772, 602],
  );
  assert.deepEqual(
    itemRect({ transform: [12, 0, 0, 12, 10, 20], width: 100, height: 12 }, 1),
    [10, 20, 110, 32],
  );
});
test("password-protected encryption dictionary is rejected explicitly", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.context.trailerInfo.Encrypt = pdf.context.register(
    pdf.context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      O: PDFHexString.of("00".repeat(32)),
      U: PDFHexString.of("00".repeat(32)),
      P: -4,
    }),
  );
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await assert.rejects(
    () => extractPdf(bytes),
    /Encrypted PDFs are not supported/,
  );
});
test("source PDFs with page rotation retain canonical user-space rectangles", async () => {
  const pdf = await PDFDocument.load(await readFile("fixtures/assessment.pdf"));
  pdf.getPage(0).setRotation(degrees(90));
  const manifest = await extractPdf(Buffer.from(await pdf.save()));
  assert.equal(manifest.pages[0].rotation, 90);
  assert.ok(manifest.segments[0].rects[0][0] >= 0);
});
