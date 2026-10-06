import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { config } from "./config";
import { AppError, type Manifest, type Rect, type Segment } from "./model";
import { endsSentence } from "./phrase-boundaries";
type Atom = {
  text: string;
  rect: Rect;
  index: number;
  size: number;
  x: number;
  y: number;
};
type Line = {
  atoms: Atom[];
  text: string;
  x: number;
  y: number;
  end: number;
  size: number;
};
export function splitUtf8(text: string, limit = 4800): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.match(/\S+\s*|\s+/gu) || []) {
    if (Buffer.byteLength(current + word, "utf8") <= limit) {
      current += word;
      continue;
    }
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
    for (const char of word) {
      if (Buffer.byteLength(current + char, "utf8") > limit) {
        chunks.push(current.trim());
        current = "";
      }
      current += char;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
export function itemRect(
  item: Pick<TextItem, "transform" | "width" | "height">,
  ascent = 0.8,
): Rect {
  const [a, b, , , x, y] = item.transform,
    theta = Math.atan2(b, a);
  const ux = Math.cos(theta),
    uy = Math.sin(theta),
    vx = -uy,
    vy = ux;
  const lower = -(1 - ascent) * item.height,
    upper = ascent * item.height;
  const corners = [
    [0, lower],
    [item.width, lower],
    [0, upper],
    [item.width, upper],
  ].map(([h, v]) => [x + ux * h + vx * v, y + uy * h + vy * v]);
  return [
    Math.min(...corners.map((c) => c[0])),
    Math.min(...corners.map((c) => c[1])),
    Math.max(...corners.map((c) => c[0])),
    Math.max(...corners.map((c) => c[1])),
  ];
}
function makeLines(atoms: Atom[]): Line[] {
  const lines: Line[] = [];
  for (const atom of [...atoms].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = lines.find(
      (l) =>
        Math.abs(l.y - atom.y) < Math.max(2, atom.size * 0.28) &&
        atom.x >= l.x - 1 &&
        atom.x - l.end < Math.max(24, atom.size * 2),
    );
    if (row) {
      const gap = atom.x - row.end;
      row.text +=
        (gap > atom.size * 0.12 &&
        !row.text.endsWith(" ") &&
        !atom.text.startsWith(" ")
          ? " "
          : "") + atom.text;
      row.atoms.push(atom);
      row.end = Math.max(row.end, atom.rect[2]);
    } else
      lines.push({
        atoms: [atom],
        text: atom.text,
        x: atom.x,
        y: atom.y,
        end: atom.rect[2],
        size: atom.size,
      });
  }
  return lines;
}
export function readingOrder(lines: Line[], width: number): Line[] {
  const mid = width / 2;
  const left = lines.filter((l) => l.x < mid - 20 && l.end < mid + 5);
  const right = lines.filter((l) => l.x >= mid - 5);
  if (left.length < 3 || right.length < 3)
    return [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
  const full = lines
    .filter((l) => !left.includes(l) && !right.includes(l))
    .sort((a, b) => b.y - a.y);
  const result: Line[] = [];
  let top = Infinity;
  for (const boundary of [...full, { y: -Infinity } as Line]) {
    for (const column of [left, right])
      result.push(
        ...column
          .filter((l) => l.y <= top && l.y > boundary.y)
          .sort((a, b) => b.y - a.y),
      );
    if (boundary.y !== -Infinity) result.push(boundary);
    top = boundary.y;
  }
  return result;
}
export function segmentsFromItems(
  items: TextItem[],
  page: number,
  width: number,
  styles: Record<string, { ascent?: number }> = {},
): Segment[] {
  const atoms: Atom[] = items
    .map((item, index) => ({
      text: item.str,
      rect: itemRect(item, styles[item.fontName]?.ascent ?? 0.8),
      index,
      size: item.height || 10,
      x: item.transform[4],
      y: item.transform[5],
    }))
    .filter((a) => a.text.trim());
  const lines = readingOrder(makeLines(atoms), width),
    blocks: Line[][] = [];
  let block: Line[] = [];
  for (const line of lines) {
    const prev = block.at(-1);
    const labelled = /^\s*(?:\d+[.)]\s+|[A-Ha-h][.)]\s+|\([A-Ha-h]\)\s+)/.test(
      line.text,
    );
    const breakLine =
      prev &&
      (labelled ||
        Math.abs(prev.x - line.x) > 32 ||
        prev.y - line.y > Math.max(prev.size, line.size) * 1.9 ||
        line.y > prev.y + 3 ||
        endsSentence(prev.text));
    if (breakLine && block.length) {
      blocks.push(block);
      block = [];
    }
    block.push(line);
  }
  if (block.length) blocks.push(block);
  const segments: Segment[] = [];
  for (const linesInBlock of blocks) {
    // Geometry is retained literally. We do not discard repeated headings, labels, or equations.
    const text = linesInBlock.map((l) => l.text.trim()).join(" "),
      rects = linesInBlock.map(
        (l) =>
          [
            Math.min(...l.atoms.map((a) => a.rect[0])),
            Math.min(...l.atoms.map((a) => a.rect[1])),
            Math.max(...l.atoms.map((a) => a.rect[2])),
            Math.max(...l.atoms.map((a) => a.rect[3])),
          ] as Rect,
      );
    const indices = linesInBlock.flatMap((l) => l.atoms.map((a) => a.index));
    for (const [part, chunk] of splitUtf8(text).entries()) {
      const id = createHash("sha256")
        .update(
          JSON.stringify({
            extractionVersion: 1,
            page,
            indices,
            part,
            text: chunk,
          }),
        )
        .digest("hex")
        .slice(0, 32);
      segments.push({
        id,
        page,
        text: chunk,
        rects,
        itemIndices: indices,
        audio: `audio/${id}.mp3`,
      });
    }
  }
  return segments;
}
export async function extractPdf(bytes: Buffer): Promise<Manifest> {
  const cfg = config(),
    require = createRequire(import.meta.url),
    pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  // The canvas package supplies DOMMatrix / Path2D used by PDF.js's maintained Node adapter.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl: join(pdfRoot, "standard_fonts") + "/",
    cMapUrl: join(pdfRoot, "cmaps") + "/",
    cMapPacked: true,
    wasmUrl: join(pdfRoot, "wasm") + "/",
  });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch (e) {
    await loading.destroy().catch(() => {});
    if ((e as Error).name === "PasswordException")
      throw new AppError(
        422,
        "Encrypted PDFs are not supported. Upload an unencrypted digital PDF.",
      );
    throw new AppError(
      422,
      "This PDF could not be parsed. Export a new digital PDF and try again.",
    );
  }
  try {
    if (pdf.numPages > cfg.maxPages)
      throw new AppError(
        422,
        `This PDF exceeds the ${cfg.maxPages}-page limit.`,
      );
    const manifest: Manifest = {
      extractionVersion: 1,
      coordinateSystem: "pdf-user-space",
      pages: [],
      segments: [],
      warnings: [],
    };
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p),
        content = await page.getTextContent();
      const items = content.items.filter((i): i is TextItem => "str" in i);
      const readable = items
        .map((i) => i.str)
        .join("")
        .replace(/\s/g, "");
      if (readable.length < 3 || !/[\p{L}\p{N}]/u.test(readable))
        throw new AppError(
          422,
          `Page ${p} has no readable text layer. Scanned and partially unreadable PDFs need OCR before upload.`,
        );
      if (items.some((i) => /[∑∫√±≠≤≥∞∂⁰¹²³�^]/u.test(i.str)))
        manifest.warnings.push(
          `Page ${p}: check mathematical notation or unsupported characters in preview. Speech reads the extracted text literally.`,
        );
      const [x1, y1, x2, y2] = page.view;
      manifest.pages.push({
        page: p,
        width: x2 - x1,
        height: y2 - y1,
        rotation: page.rotate,
      });
      manifest.segments.push(
        ...segmentsFromItems(items, p, x2 + x1, content.styles),
      );
      page.cleanup();
      if (manifest.segments.length > cfg.maxSegments)
        throw new AppError(
          422,
          `This PDF exceeds the ${cfg.maxSegments}-segment limit. Split it into smaller assessments.`,
        );
    }
    const chars = manifest.segments.reduce((n, s) => n + s.text.length, 0);
    if (chars > cfg.maxChars)
      throw new AppError(
        422,
        `This PDF exceeds the ${cfg.maxChars}-character speech limit.`,
      );
    if (!manifest.segments.length)
      throw new AppError(422, "No speech segments could be extracted.");
    return manifest;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      422,
      "Text extraction failed on this PDF. Export a new digital PDF and check that every page has selectable text.",
    );
  } finally {
    await loading.destroy();
  }
}
