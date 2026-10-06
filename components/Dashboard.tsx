"use client";
import { useEffect, useState, useCallback } from "react";
import Brand from "./Brand";
import WindowFields from "./WindowFields";
import { apiFetch, jsonRequest, wallInput, formatTime } from "@/lib/client";
import type { Identity, ReaderDocument } from "@/lib/model";
type Doc = Omit<
  ReaderDocument,
  "ownerId" | "encryptedToken" | "tokenHash" | "leaseId" | "leaseUntil"
> & { shareUrl: string };
type Settings = {
  local: boolean;
  origin: string;
  authConfigured: boolean;
  timezone: string;
  voices: string[];
  maxUpload: number;
  maxPages: number;
};
export default function Dashboard() {
  const [settings, setSettings] = useState<Settings>(),
    [user, setUser] = useState<Identity | null>(null),
    [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<Doc[]>([]),
    [selected, setSelected] = useState<string>(),
    [uploading, setUploading] = useState(false),
    [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const result = await apiFetch<Doc[]>("/api/documents");
    setDocs(result);
  }, []);
  useEffect(() => {
    Promise.all([
      apiFetch<Settings>("/api/config").then(setSettings),
      apiFetch<Identity>("/api/auth/me")
        .then(setUser)
        .catch(() => setUser(null)),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, [user, refresh]);
  async function login(account: string) {
    try {
      setUser(
        await apiFetch<Identity>(
          "/api/auth/local",
          jsonRequest("POST", { account }),
        ),
      );
      setDocs([]);
      setSelected(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function action(
    doc: Doc,
    name: "disable" | "rotate" | "retry" | "delete",
  ) {
    if (
      (name === "delete" || name === "rotate") &&
      !confirm(
        name === "delete"
          ? "Delete this assessment and its cached audio? This cannot be undone."
          : "Replace the share link? The old link will stop working immediately.",
      )
    )
      return;
    try {
      setError("");
      await apiFetch(
        `/api/documents/${doc.id}${name === "delete" ? "" : "/" + name}`,
        jsonRequest(name === "delete" ? "DELETE" : "POST"),
      );
      await refresh();
      setNotice(
        name === "delete"
          ? "Assessment deleted."
          : name === "rotate"
            ? "A new share link is ready. The old link has been invalidated."
            : name === "disable"
              ? "Student access has been disabled."
              : "Processing queued.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const current = docs.find((d) => d.id === selected);
  return (
    <>
      <header className="app-header">
        <Brand />
        <div className="header-account">
          {user && (
            <>
              <span>{user.email}</span>
              <button
                className="text-button"
                onClick={async () => {
                  await apiFetch("/api/auth/logout", jsonRequest("POST"));
                  setUser(null);
                  setDocs([]);
                }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>
      <main className="dashboard">
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {loading ? (
          <p className="muted">Loading your workspace…</p>
        ) : !user ? (
          <section className="welcome">
            <div className="welcome-mark" aria-hidden="true">
              Aa<span>▸</span>
            </div>
            <h1>
              Give every assessment
              <br />a voice.
            </h1>
            <p>
              Upload a PDF, prepare its speech, and share a link that opens only
              when you choose.
            </p>
            {settings?.local ? (
              <>
                <div className="local-note">
                  Local demo · prerecorded fixture audio · no cloud services
                </div>
                <button className="primary" onClick={() => login("one")}>
                  Open demo workspace
                </button>
                <button onClick={() => login("two")}>
                  Use second demo account
                </button>
              </>
            ) : settings?.authConfigured ? (
              <a
                className="button primary"
                href={`${settings.origin}/api/auth/login`}
              >
                Sign in with Google
              </a>
            ) : (
              <div className="setup-note">
                Google sign-in is awaiting Internal OAuth setup. Student access
                and the dashboard remain protected.
              </div>
            )}
            <div className="welcome-foot">
              Original PDFs. Cached speech. Timed access.
            </div>
          </section>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Your assessments</h1>
                <p className="muted">Prepare once. Share when it’s time.</p>
              </div>
              <button
                className="primary"
                onClick={() => setShowUpload((v) => !v)}
              >
                {showUpload ? "Close upload" : "+ New assessment"}
              </button>
            </div>
            {settings?.local && (
              <div className="local-note">
                Local demo. Use{" "}
                <a href="/fixture.pdf" download>
                  the assessment fixture
                </a>{" "}
                for matching prerecorded speech. Other PDFs use a clearly
                identified mock clip. Run the local worker to process uploads.
              </div>
            )}
            {showUpload && settings && (
              <UploadForm
                settings={settings}
                busy={uploading}
                onUpload={async (form) => {
                  setUploading(true);
                  setError("");
                  try {
                    const doc = await apiFetch<Doc>("/api/documents", {
                      method: "POST",
                      body: form,
                    });
                    setSelected(doc.id);
                    setShowUpload(false);
                    await refresh();
                    setNotice("Upload received. Speech preparation is queued.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            )}
            <div className={`workspace ${current ? "has-detail" : ""}`}>
              <section className="document-list" aria-label="Your assessments">
                <div className="list-heading">
                  <span>Assessment</span>
                  <span>Speech / access</span>
                </div>
                {docs.length ? (
                  docs.map((doc) => (
                    <button
                      className={`document-row ${selected === doc.id ? "selected" : ""}`}
                      key={doc.id}
                      onClick={() => setSelected(doc.id)}
                    >
                      <div className="document-main">
                        <span className="file-icon" aria-hidden="true">
                          PDF
                        </span>
                        <div>
                          <strong>{doc.title}</strong>
                          <small>
                            {doc.pages ? `${doc.pages} pages · ` : ""}
                            {formatTime(doc.availableAt, doc.timezone)} →{" "}
                            {formatTime(doc.expiresAt, doc.timezone)}
                          </small>
                        </div>
                      </div>
                      <div className="document-state">
                        <span
                          className={`status ${doc.status === "ready" && doc.enabled ? "ready" : doc.status === "failed" || !doc.enabled ? "failed" : "working"}`}
                        >
                          {!doc.enabled
                            ? "Disabled"
                            : doc.status === "ready"
                              ? "Ready"
                              : doc.status === "failed"
                                ? "Needs attention"
                                : "Preparing"}
                        </span>
                        {["queued", "processing"].includes(doc.status) && (
                          <small>
                            {doc.completedSegments} / {doc.totalSegments || "—"}{" "}
                            segments
                          </small>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <div className="empty-file" aria-hidden="true">
                      PDF
                    </div>
                    <h2>Your first assessment starts here.</h2>
                    <p>
                      Upload a digital PDF with selectable text.
                      <br />
                      You’ll get a preview and a timed share link.
                    </p>
                    <button onClick={() => setShowUpload(true)}>
                      Upload a PDF
                    </button>
                  </div>
                )}
              </section>
              {current && (
                <DocumentDetail
                  key={current.id}
                  doc={current}
                  onSave={async (data) => {
                    try {
                      await apiFetch(
                        `/api/documents/${current.id}`,
                        jsonRequest("PATCH", data),
                      );
                      await refresh();
                      setNotice("Availability saved.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  onAction={(name) => action(current, name)}
                  onClose={() => setSelected(undefined)}
                />
              )}
            </div>
            <footer className="dashboard-foot">
              Only your account can manage these assessments. Shared links allow
              anonymous access during the chosen window.
            </footer>
          </>
        )}
      </main>
    </>
  );
}
function UploadForm({
  settings,
  busy,
  onUpload,
}: {
  settings: Settings;
  busy: boolean;
  onUpload: (form: FormData) => void;
}) {
  const [title, setTitle] = useState(""),
    [window, setWindow] = useState({
      start: wallInput(Date.now(), settings.timezone),
      end: wallInput(Date.now() + 3600000, settings.timezone),
      timezone: settings.timezone,
    });
  return (
    <form
      className="upload-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onUpload(new FormData(e.currentTarget));
      }}
    >
      <div className="form-heading">
        <h2>New assessment</h2>
        <p>
          Up to {Math.round(settings.maxUpload / 1024 / 1024)} MB ·{" "}
          {settings.maxPages} pages · digital PDFs
        </p>
      </div>
      <label className="upload-file">
        Assessment PDF
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          onChange={(e) => {
            if (!title)
              setTitle(e.target.files?.[0]?.name.replace(/\.pdf$/i, "") || "");
          }}
        />
      </label>
      <label>
        Title
        <input
          name="title"
          maxLength={160}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Assessment title"
        />
      </label>
      <WindowFields
        {...window}
        onChange={(key, value) => setWindow((w) => ({ ...w, [key]: value }))}
      />
      <label>
        Speech voice
        <select name="voice">
          {settings.voices.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" disabled={busy}>
        {busy ? "Uploading…" : "Upload & prepare speech"}
      </button>
      <p className="muted small">
        All audio is prepared before the assessment is marked Ready.
      </p>
    </form>
  );
}
function DocumentDetail({
  doc,
  onSave,
  onAction,
  onClose,
}: {
  doc: Doc;
  onSave: (data: unknown) => void;
  onAction: (name: "disable" | "rotate" | "retry" | "delete") => void;
  onClose: () => void;
}) {
  const [window, setWindow] = useState({
      start: wallInput(doc.availableAt, doc.timezone),
      end: wallInput(doc.expiresAt, doc.timezone),
      timezone: doc.timezone,
    }),
    [enabled, setEnabled] = useState(doc.enabled),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setWindow({
      start: wallInput(doc.availableAt, doc.timezone),
      end: wallInput(doc.expiresAt, doc.timezone),
      timezone: doc.timezone,
    });
    setEnabled(doc.enabled);
  }, [doc.availableAt, doc.expiresAt, doc.timezone, doc.enabled]);
  useEffect(() => {
    setCopied(false);
  }, [doc.shareUrl]);
  return (
    <aside className="detail-panel">
      <div className="detail-heading">
        <h2>{doc.title}</h2>
        <button aria-label="Close assessment details" onClick={onClose}>
          ×
        </button>
      </div>
      {doc.error && <div className="alert error">{doc.error}</div>}
      {doc.status === "ready" && (
        <a
          className="button preview-button"
          href={`/preview/${doc.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open teacher preview ↗
        </a>
      )}
      <p className="muted small">
        {doc.totalSegments
          ? `${doc.completedSegments} of ${doc.totalSegments} audio segments prepared.`
          : "Waiting for text extraction."}{" "}
        {doc.voice}
      </p>
      {doc.warnings.map((w) => (
        <p className="warning small" key={w}>
          {w}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...window, enabled });
        }}
      >
        <h3>Availability</h3>
        <WindowFields
          {...window}
          onChange={(key, value) => setWindow((w) => ({ ...w, [key]: value }))}
        />
        <label className="check-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Allow student access in this window
        </label>
        <button type="submit">Save availability</button>
      </form>
      <div className="share-section">
        <h3>Student link</h3>
        <p className="small muted">
          Anyone with this link can open the assessment while it is Ready,
          enabled, and within its window.
        </p>
        <input aria-label="Student share link" value={doc.shareUrl} readOnly />
        <button
          disabled={doc.status !== "ready"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(doc.shareUrl);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <div className="document-actions">
        {doc.enabled && (
          <button className="danger" onClick={() => onAction("disable")}>
            Disable now
          </button>
        )}
        {doc.status !== "ready" && (
          <button onClick={() => onAction("retry")}>Retry processing</button>
        )}
        <button onClick={() => onAction("rotate")}>Replace share link</button>
        <button
          className="text-button danger"
          onClick={() => onAction("delete")}
        >
          Delete assessment
        </button>
      </div>
    </aside>
  );
}
