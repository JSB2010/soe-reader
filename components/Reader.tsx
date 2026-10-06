"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Manifest, Segment } from "@/lib/model";
import { apiFetch } from "@/lib/client";
import { Playback } from "@/lib/playback";
import PdfPage from "./PdfPage";
type Session = {
  id: string;
  title: string;
  expiresAt: number | null;
  serverNow: number;
};
export default function Reader({ previewId }: { previewId?: string }) {
  const [session, setSession] = useState<Session>(),
    [manifest, setManifest] = useState<Manifest>(),
    [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [message, setMessage] = useState("Opening assessment…"),
    [page, setPage] = useState(1),
    [scale, setScale] = useState(1.15),
    [rotation, setRotation] = useState(0);
  const [active, setActive] = useState<Segment | null>(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [audioError, setAudioError] = useState(""),
    [textOpen, setTextOpen] = useState(false);
  const player = useRef<Playback | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    loadingTask = useRef<{ destroy: () => Promise<void> } | null>(null),
    expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false),
    generation = useRef(0),
    abort = useRef<AbortController | null>(null);
  const tokenRef = useRef<string | null>(null);
  const fail = useCallback((value: string) => {
    stopped.current = true;
    generation.current++;
    abort.current?.abort();
    player.current?.stop();
    loadingTask.current?.destroy().catch(() => {});
    setPdf(undefined);
    setManifest(undefined);
    setActive(null);
    setSession(undefined);
    setMessage(value);
  }, []);
  const setExpiry = useCallback(
    (expiresAt: number | null, serverNow: number) => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      if (expiresAt !== null)
        expiryTimer.current = setTimeout(
          () => fail("This assessment has ended."),
          Math.min(2147483647, Math.max(0, expiresAt - serverNow)),
        );
    },
    [fail],
  );
  useEffect(() => {
    const media = new Audio();
    media.preload = "none";
    audio.current = media;
    player.current = new Playback(media, (value, error) => {
      setPlaying(value);
      if (error) setAudioError(error);
    });
    media.onended = () => setPlaying(false);
    media.onerror = () => {
      if (!stopped.current && media.getAttribute("src")) {
        setPlaying(false);
        setAudioError(
          "Audio is unavailable. Check the access window, then try again.",
        );
      }
    };
    return () => {
      media.onended = null;
      media.onerror = null;
      player.current?.stop();
    };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    stopped.current = false;
    abort.current = new AbortController();
    const signal = abort.current.signal;
    let policyInterval: ReturnType<typeof setInterval> | undefined;
    tokenRef.current ??= window.location.hash.slice(1);
    const hash = tokenRef.current,
      previousId = new URL(window.location.href).searchParams.get("document");
    let openedId = previewId;
    if (!previewId)
      history.replaceState(
        null,
        "",
        window.location.pathname +
          (previousId ? `?document=${encodeURIComponent(previousId)}` : ""),
      );
    async function policy(id: string) {
      const began = performance.now();
      try {
        const p = await apiFetch<{
          expiresAt: number | null;
          serverNow: number;
        }>(`/api/reader/${id}/policy${previewId ? "?preview=1" : ""}`, {
          signal,
        });
        if (!stopped.current)
          setExpiry(p.expiresAt, p.serverNow + performance.now() - began);
      } catch (e) {
        if ((e as Error).name !== "AbortError") fail((e as Error).message);
      }
    }
    (async () => {
      const began = performance.now();
      let opened: Session;
      if (previewId) {
        const info = await apiFetch<{ title: string }>(
          "/api/documents/" + previewId,
          { signal },
        );
        opened = {
          id: previewId,
          title: info.title,
          expiresAt: null,
          serverNow: Date.now(),
        };
      } else if (hash) {
        opened = await apiFetch<Session>("/api/reader/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: hash }),
          signal,
        });
      } else if (previousId) {
        const info = await apiFetch<Omit<Session, "id">>(
          `/api/reader/${encodeURIComponent(previousId)}/policy`,
          { signal },
        );
        opened = { ...info, id: previousId };
      } else {
        throw new Error(
          "Open the complete assessment link provided by your teacher.",
        );
      }
      openedId = opened.id;
      if (!previewId)
        history.replaceState(
          null,
          "",
          `/read?document=${encodeURIComponent(opened.id)}`,
        );
      const suffix = previewId ? "?preview=1" : "",
        base = `/api/reader/${opened.id}`;
      const segments = await apiFetch<Manifest>(base + "/manifest" + suffix, {
        signal,
      });
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({
        url: base + "/pdf" + suffix,
        withCredentials: true,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
      });
      loadingTask.current = task;
      const document = await task.promise;
      if (current !== generation.current || stopped.current) {
        await task.destroy();
        return;
      }
      setSession(opened);
      setManifest(segments);
      setPdf(document);
      setMessage("");
      setExpiry(opened.expiresAt, opened.serverNow + performance.now() - began);
      policyInterval = setInterval(() => policy(opened.id), 5000);
    })().catch((e) => {
      if (current === generation.current && e.name !== "AbortError")
        fail(e.message);
    });
    const onResume = () => {
      if (!document.hidden) {
        player.current?.pause();
        if (openedId) policy(openedId);
      } else player.current?.pause();
    };
    document.addEventListener("visibilitychange", onResume);
    return () => {
      generation.current++;
      abort.current?.abort();
      if (policyInterval) clearInterval(policyInterval);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      document.removeEventListener("visibilitychange", onResume);
      loadingTask.current?.destroy().catch(() => {});
    };
    // session is established once. Policy reads use the ID captured after startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId, fail, setExpiry]);
  const play = useCallback(
    (segment: Segment) => {
      if (!session || stopped.current) return;
      setAudioError("");
      setActive(segment);
      setPage(segment.page);
      player.current?.start(
        `/api/reader/${session.id}/${segment.audio}${previewId ? "?preview=1" : ""}`,
      );
      player.current?.speed(speed);
    },
    [session, previewId, speed],
  );
  const pageSegments = manifest?.segments.filter((s) => s.page === page) || [];
  function navigateSegment(direction: number) {
    if (!manifest) return;
    const index = active
      ? manifest.segments.findIndex((s) => s.id === active.id)
      : 0;
    const target =
      manifest.segments[
        Math.max(0, Math.min(manifest.segments.length - 1, index + direction))
      ];
    if (target) play(target);
  }
  return (
    <div className="reader-shell">
      <header className="reader-header">
        <span className="reader-brand">SOE Reader</span>
        <strong>
          {session?.title ||
            (previewId ? "Teacher preview" : "Assessment reader")}
        </strong>
        {previewId && <span className="preview-label">Teacher preview</span>}
      </header>
      {session && manifest && pdf ? (
        <>
          <div className="reader-toolbar" aria-label="Reading controls">
            <div className="toolbar-group">
              <button
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => {
                  player.current?.stop();
                  setActive(null);
                  setPage((p) => p - 1);
                }}
              >
                ‹
              </button>
              <span>
                Page {page} / {manifest.pages.length}
              </span>
              <button
                aria-label="Next page"
                disabled={page === manifest.pages.length}
                onClick={() => {
                  player.current?.stop();
                  setActive(null);
                  setPage((p) => p + 1);
                }}
              >
                ›
              </button>
            </div>
            <div className="toolbar-group">
              <button
                aria-label="Zoom out"
                disabled={scale <= 0.5}
                onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
              >
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button
                aria-label="Zoom in"
                disabled={scale >= 2.5}
                onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
              >
                +
              </button>
              <button
                aria-label="Rotate page clockwise"
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                ↻
              </button>
            </div>
            <div className="toolbar-group playback-controls">
              <button
                className="primary"
                aria-label={playing ? "Pause speech" : "Play speech"}
                onClick={() => {
                  if (playing) player.current?.pause();
                  else if (active) player.current?.resume();
                  else if (pageSegments[0]) play(pageSegments[0]);
                }}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => {
                  player.current?.stop();
                  setActive(null);
                }}
              >
                Stop
              </button>
              <label className="speed-label">
                Speed
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => {
                    setSpeed(Number(e.target.value));
                    player.current?.speed(Number(e.target.value));
                  }}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setTextOpen((v) => !v)}
                aria-expanded={textOpen}
              >
                Passages
              </button>
            </div>
          </div>
          {audioError && (
            <div className="alert error" role="alert">
              {audioError}
            </div>
          )}
          <div className="reader-instruction">
            Click text to hear its complete passage.{" "}
            <button
              className="text-button"
              aria-label="Previous speech segment"
              onClick={() => navigateSegment(-1)}
            >
              Previous passage
            </button>
            <button
              className="text-button"
              aria-label="Next speech segment"
              onClick={() => navigateSegment(1)}
            >
              Next passage
            </button>
          </div>
          <main className="reading-area">
            <div className="pdf-scroll">
              <PdfPage
                pdf={pdf}
                pageNumber={page}
                scale={scale}
                rotation={rotation}
                segments={pageSegments}
                active={active?.id || null}
                onPlay={play}
                onError={fail}
              />
            </div>
            {textOpen && (
              <aside className="passage-panel">
                <h2>{previewId ? "Extracted text" : "Passages"}</h2>
                {previewId &&
                  manifest.warnings.map((w) => (
                    <p className="warning" key={w}>
                      {w}
                    </p>
                  ))}
                {pageSegments.map((s) => (
                  <button
                    className={active?.id === s.id ? "selected" : ""}
                    key={s.id}
                    onClick={() => play(s)}
                  >
                    {s.text}
                  </button>
                ))}
              </aside>
            )}
          </main>
          <div className="reader-status" role="status">
            {active
              ? `${playing ? "Reading" : "Selected"}: ${active.text}`
              : "Select a passage to begin."}
          </div>
        </>
      ) : (
        <main className="reader-message">
          <div aria-hidden="true" className="empty-file">
            Aa
          </div>
          <h1>{message || "Loading assessment…"}</h1>
          <p>
            The assessment and its audio are available only during your
            teacher’s access window.
          </p>
        </main>
      )}
    </div>
  );
}
