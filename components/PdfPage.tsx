"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Segment } from "@/lib/model";
import { viewportRect } from "@/lib/geometry";
export default function PdfPage({
  pdf,
  pageNumber,
  scale,
  rotation,
  segments,
  active,
  onPlay,
  onError,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  segments: Segment[];
  active: string | null;
  onPlay: (segment: Segment) => void;
  onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState<{
      width: number;
      height: number;
      transform: number[];
    }>();
  useEffect(() => {
    let disposed = false;
    let render: { cancel: () => void } | undefined;
    let textLayer: { cancel: () => void } | undefined;
    (async () => {
      const pdfjs = await import("pdfjs-dist"),
        page = await pdf.getPage(pageNumber);
      if (disposed || !canvas.current || !text.current) return;
      const view = page.getViewport({
          scale,
          rotation: (page.rotate + rotation) % 360,
        }),
        ratio = window.devicePixelRatio || 1;
      const surface = canvas.current;
      surface.width = Math.floor(view.width * ratio);
      surface.height = Math.floor(view.height * ratio);
      surface.style.width = `${view.width}px`;
      surface.style.height = `${view.height}px`;
      setViewport({
        width: view.width,
        height: view.height,
        transform: view.transform,
      });
      const task = page.render({
        canvas: surface,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        viewport: view,
      });
      render = task;
      const content = await page.getTextContent();
      if (disposed || !text.current) return;
      text.current.replaceChildren();
      text.current.style.setProperty("--scale-factor", String(scale));
      const layer = new pdfjs.TextLayer({
        textContentSource: content,
        container: text.current,
        viewport: view,
      });
      textLayer = layer;
      await Promise.all([task.promise, layer.render()]);
    })().catch((e) => {
      if (
        !disposed &&
        !["RenderingCancelledException", "AbortException"].includes(e.name)
      )
        onError("The PDF page could not be rendered. Reload the assessment.");
    });
    return () => {
      disposed = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, scale, rotation, onError]);
  return (
    <div
      className="pdf-page"
      style={
        viewport
          ? { width: viewport.width, height: viewport.height }
          : undefined
      }
    >
      <canvas ref={canvas} aria-label={`Original PDF page ${pageNumber}`} />
      <div ref={text} className="textLayer" aria-hidden="true" />
      {viewport && (
        <div className="speech-layer">
          {segments.flatMap((segment) =>
            segment.rects.map((rect, index) => {
              const [left, top, right, bottom] = viewportRect(
                rect,
                viewport.transform,
              );
              return (
                <button
                  key={`${segment.id}-${index}`}
                  className={`speech-region ${active === segment.id ? "active" : ""}`}
                  style={{
                    left,
                    top,
                    width: right - left,
                    height: bottom - top,
                  }}
                  aria-label={`Read: ${segment.text}`}
                  title={segment.text}
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => onPlay(segment)}
                />
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}
