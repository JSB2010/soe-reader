"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Manifest, Segment } from "@/lib/model";
import { apiFetch } from "@/lib/client";
import {
  AssessmentPlayback,
  type PlayerState,
} from "@/lib/assessment-playback";
import { clock } from "@/lib/timeline";
import Brand from "./Brand";
import Loading from "./Loading";
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
  const [message, setMessage] = useState(""),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1.15),
    [fit, setFit] = useState(false),
    [rotation, setRotation] = useState(0),
    [viewerWidth, setViewerWidth] = useState(900);
  const [playback, setPlayback] = useState<PlayerState>({
      index: null,
      playing: false,
      elapsed: 0,
      total: 0,
      estimated: false,
    }),
    [speed, setSpeed] = useState(1),
    [audioError, setAudioError] = useState("");
  const player = useRef<AssessmentPlayback | null>(null),
    scrollRoot = useRef<HTMLDivElement>(null),
    loadingTask = useRef<{ destroy: () => Promise<void> } | null>(null),
    expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false),
    generation = useRef(0),
    abort = useRef<AbortController | null>(null);
  const tokenRef = useRef<string | null>(null),
    pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    if (window.innerWidth < 820) setFit(true);
  }, []);
  const fail = useCallback((value: string) => {
    stopped.current = true;
    generation.current++;
    abort.current?.abort();
    player.current?.stop();
    loadingTask.current?.destroy().catch(() => {});
    setPdf(undefined);
    setManifest(undefined);

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
  const grouped = useMemo(() => {
    const result = new Map<number, Segment[]>();
    manifest?.segments.forEach((s) => {
      const list = result.get(s.page) || [];
      list.push(s);
      result.set(s.page, list);
    });
    return result;
  }, [manifest]);
  const active =
    playback.index === null ? undefined : manifest?.segments[playback.index];
  useEffect(() => {
    if (!session || !manifest) return;
    const media = new Audio();
    media.preload = "metadata";
    const controller = new AssessmentPlayback(
      media,
      manifest.segments,
      (segment) =>
        `/api/reader/${session.id}/${segment.audio}${previewId ? "?preview=1" : ""}`,
      (state) => {
        setPlayback(state);
        if (state.error) setAudioError(state.error);
      },
    );
    player.current = controller;
    return () => {
      controller.dispose();
      media.removeAttribute("src");
      media.load();
      player.current = null;
    };
  }, [session, manifest, previewId]);
  useEffect(() => {
    player.current?.speed(speed);
  }, [speed, session]);
  useEffect(() => {
    const root = scrollRoot.current;
    if (!root || !pdf) return;
    const resize = new ResizeObserver(() => setViewerWidth(root.clientWidth));
    resize.observe(root);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length)
          setPage(Number((visible[0].target as HTMLElement).dataset.page));
      },
      { root, rootMargin: "-5% 0px -75% 0px" },
    );
    root
      .querySelectorAll(".pdf-sheet")
      .forEach((node) => observer.observe(node));
    return () => {
      resize.disconnect();
      observer.disconnect();
    };
  }, [pdf]);
  const revealActive = useCallback(
    (renderedPage?: number) => {
      const root = scrollRoot.current;
      if (!root || !active) return;
      if (
        renderedPage !== undefined &&
        (pendingReveal.current !== active.id || renderedPage !== active.page)
      )
        return;
      const button = root.querySelector<HTMLElement>(
        `[data-segment="${active.id}"]`,
      );
      const bounds = root.getBoundingClientRect(),
        target = button?.getBoundingClientRect();
      if (
        target &&
        (target.top < bounds.top + 20 || target.bottom > bounds.bottom - 20)
      )
        button?.scrollIntoView({ block: "center", behavior: "auto" });
      else if (!button)
        root
          .querySelector<HTMLElement>(`[data-page="${active.page}"]`)
          ?.scrollIntoView({ block: "start", behavior: "auto" });
      pendingReveal.current = button ? null : active.id;
    },
    [active],
  );
  useEffect(() => {
    pendingReveal.current = active?.id || null;
    revealActive();
  }, [active?.id, revealActive]);
  useEffect(() => {
    if (playback.playing) revealActive();
  }, [playback.playing, revealActive]);
  const play = useCallback(
    (segment: Segment) => {
      if (stopped.current) return;
      setAudioError("");
      const index = manifest?.segments.findIndex((s) => s.id === segment.id);
      if (index !== undefined && index >= 0) player.current?.select(index);
    },
    [manifest],
  );
  const pageInfo = manifest?.pages[page - 1];
  const sideways = pageInfo && (pageInfo.rotation + rotation) % 180 !== 0;
  const scale =
    fit && pageInfo
      ? (viewerWidth - 48) / (sideways ? pageInfo.height : pageInfo.width)
      : zoom;
  function jumpPage(target: number) {
    scrollRoot.current
      ?.querySelector<HTMLElement>(`[data-page="${target}"]`)
      ?.scrollIntoView({ block: "start", behavior: "auto" });
    setPage(target);
  }
  return (
    <div className="reader-shell">
      <header className="reader-header">
        <Brand linked={false} />
        <strong>
          {session?.title ||
            (previewId ? "Teacher preview" : "Assessment reader")}
        </strong>
        {previewId && <span className="preview-label">Teacher preview</span>}
      </header>
      {session && manifest && pdf ? (
        <>
          <div
            className="reader-toolbar"
            role="region"
            aria-label="Reading controls"
          >
            <div className="toolbar-main">
              <div className="toolbar-group playback-controls">
                <button
                  aria-label="Previous speech segment"
                  title="Previous passage"
                  onClick={() => player.current?.next(-1)}
                >
                  ‹
                </button>
                <button
                  className="primary play-button"
                  aria-label={playback.playing ? "Pause speech" : "Play speech"}
                  onClick={() => {
                    setAudioError("");
                    if (playback.playing) player.current?.pause();
                    else player.current?.play();
                  }}
                >
                  {playback.playing ? "Pause" : "Play"}
                </button>
                <button
                  aria-label="Next speech segment"
                  title="Next passage"
                  onClick={() => player.current?.next(1)}
                >
                  ›
                </button>
                <button
                  onClick={() => {
                    player.current?.stop();
                    setAudioError("");
                  }}
                >
                  Stop
                </button>
                <button
                  className="skip-button"
                  aria-label="Rewind 10 seconds"
                  title="Rewind 10 seconds"
                  onClick={() => player.current?.skip(-10)}
                >
                  −10s
                </button>
                <button
                  className="skip-button"
                  aria-label="Forward 10 seconds"
                  title="Forward 10 seconds"
                  onClick={() => player.current?.skip(10)}
                >
                  +10s
                </button>
              </div>
              <span className="toolbar-hint">
                Click text to read a passage. Play reads the whole assessment.
              </span>
              <div className="toolbar-group view-controls">
                <label className="compact-label">
                  <span className="sr-only">Go to page</span>
                  <select
                    aria-label="Go to page"
                    value={page}
                    onChange={(e) => jumpPage(Number(e.target.value))}
                  >
                    {manifest.pages.map((p) => (
                      <option key={p.page} value={p.page}>
                        Page {p.page} / {manifest.pages.length}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label="Zoom out"
                  disabled={!fit && zoom <= 0.35}
                  onClick={() => {
                    setFit(false);
                    setZoom(Math.max(0.35, scale - 0.15));
                  }}
                >
                  −
                </button>
                <span className="zoom-value">{Math.round(scale * 100)}%</span>
                <button
                  aria-label="Zoom in"
                  disabled={!fit && zoom >= 3}
                  onClick={() => {
                    setFit(false);
                    setZoom(Math.min(3, scale + 0.15));
                  }}
                >
                  +
                </button>
                <button
                  aria-label="Fit to width"
                  aria-pressed={fit}
                  onClick={() => setFit(true)}
                >
                  Fit
                </button>
                <button
                  aria-label="Rotate page clockwise"
                  title="Rotate pages"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  ↻
                </button>
              </div>
            </div>
            <div className="toolbar-progress">
              <span className="playback-time">
                {clock(playback.elapsed)} / {playback.estimated ? "~" : ""}
                {clock(playback.total)}
              </span>
              <input
                type="range"
                aria-label="Reading progress"
                aria-valuetext={`${clock(playback.elapsed)} of ${clock(playback.total)}`}
                min="0"
                max={Math.max(1, playback.total)}
                step=".1"
                value={playback.elapsed}
                onChange={(e) => player.current?.seek(Number(e.target.value))}
              />
              <label className="speed-label">
                Speed
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {audioError && (
            <div className="alert error reader-alert" role="alert">
              {audioError}
              <button
                aria-label="Dismiss audio error"
                onClick={() => setAudioError("")}
              >
                ×
              </button>
            </div>
          )}
          {previewId && manifest.warnings.length > 0 && (
            <details className="preview-notes">
              <summary>Preview notes ({manifest.warnings.length})</summary>
              {manifest.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </details>
          )}
          <main
            ref={scrollRoot}
            className="pdf-scroll"
            aria-label="Assessment pages"
          >
            <div className="document-stack">
              {manifest.pages.map((info) => (
                <PdfPage
                  key={info.page}
                  pdf={pdf}
                  pageInfo={info}
                  root={scrollRoot}
                  scale={
                    fit
                      ? (viewerWidth - 48) /
                        ((info.rotation + rotation) % 180 !== 0
                          ? info.height
                          : info.width)
                      : zoom
                  }
                  rotation={rotation}
                  segments={grouped.get(info.page) || []}
                  active={active?.page === info.page ? active.id : null}
                  onPlay={play}
                  onError={fail}
                  onReady={revealActive}
                />
              ))}
            </div>
          </main>
          <span className="sr-only" role="status">
            {active
              ? `${playback.playing ? "Reading" : "Selected"}: ${active.text}`
              : "Ready to read"}
          </span>
        </>
      ) : message ? (
        <main className="reader-message">
          <h1>{message}</h1>
        </main>
      ) : (
        <main className="reader-loading">
          <Loading label="Loading assessment…" />
        </main>
      )}
    </div>
  );
}
