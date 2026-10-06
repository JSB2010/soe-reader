import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
await mkdir("public/pdfjs", { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"])
  await cp(join(root, name), `public/pdfjs/${name}`, { recursive: true });
await cp(
  join(root, "build/pdf.worker.min.mjs"),
  "public/pdfjs/pdf.worker.min.mjs",
);
await cp(join(root, "web/pdf_viewer.css"), "public/pdfjs/pdf_viewer.css");
