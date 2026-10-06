"use client";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Segment, Manifest } from "@/lib/model";
import { viewportRect } from "@/lib/geometry";
import Loading from "./Loading";
function PdfPage({
  pdf,
  pageInfo,
  root,
  scale,
  rotation,
  segments,
  active,
  onPlay,
  onError,
  onReady,
}: {
  pdf: PDFDocumentProxy;
  pageInfo: Manifest["pages"][number];
  root: RefObject<HTMLDivElement | null>;
  scale: number;
  rotation: number;
  segments: Segment[];
  active: string | null;
  onPlay: (segment: Segment) => void;
  onError: (message: string) => void;
  onReady: (page: number) => void;
}) {
  const sheet = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [near, setNear] = useState(pageInfo.page === 1),
    [rendered, setRendered] = useState(false),
    [viewport, setViewport] = useState<{
      width: number;
      height: number;
      transform: number[];
    }>();
  const sideways = (pageInfo.rotation + rotation) % 180 !== 0,
    width = (sideways ? pageInfo.height : pageInfo.width) * scale,
    height = (sideways ? pageInfo.width : pageInfo.height) * scale;
  useEffect(() => {
    if (!sheet.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: root.current, rootMargin: "1000px 0px" },
    );
    observer.observe(sheet.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near) return;
    let disposed = false,
      render: { cancel: () => void } | undefined,
      textLayer: { cancel: () => void } | undefined;
    setRendered(false);
    (async () => {
      const pdfjs = await import("pdfjs-dist"),
        page = await pdf.getPage(pageInfo.page);
      if (disposed || !canvas.current || !text.current) return;
      const view = page.getViewport({
          scale,
          rotation: (page.rotate + rotation) % 360,
        }),
        ratio = Math.min(2, window.devicePixelRatio || 1),
        surface = canvas.current;
      surface.width = Math.floor(view.width * ratio);
      surface.height = Math.floor(view.height * ratio);
      surface.style.width = `${view.width}px`;
      surface.style.height = `${view.height}px`;
      setViewport({
        width: view.width,
        height: view.height,
        transform: view.transform,
      });
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
      const task = page.render({
        canvas: surface,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        viewport: view,
      });
      render = task;

      await Promise.all([task.promise, layer.render()]);
      if (!disposed) {
        setRendered(true);
        requestAnimationFrame(() => {
          if (!disposed) readyCallback.current(pageInfo.page);
        });
      }
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
  }, [pdf, pageInfo.page, scale, rotation, near, onError]);
  return (
    <section
      ref={sheet}
      className="pdf-sheet"
      data-page={pageInfo.page}
      aria-label={`Page ${pageInfo.page}`}
      style={{ width, height }}
    >
      <div className="pdf-page" style={{ width, height }}>
        {near ? (
          <>
            <canvas
              ref={canvas}
              aria-label={`Original PDF page ${pageInfo.page}`}
            />
            <div ref={text} className="textLayer" aria-hidden="true" />
            {!rendered && (
              <Loading
                label={`Loading page ${pageInfo.page}…`}
                className="page-render-loading"
              />
            )}
            {viewport && rendered && (
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
                        data-segment={segment.id}
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
          </>
        ) : (
          <div className="page-placeholder">
            <span>Page {pageInfo.page}</span>
          </div>
        )}
      </div>
    </section>
  );
}
export default memo(PdfPage);
