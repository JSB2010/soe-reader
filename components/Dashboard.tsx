"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Brand from "./Brand";
import Loading from "./Loading";
import WindowFields from "./WindowFields";
import VoicePicker from "./VoicePicker";
import { voiceInfo, voiceLabel } from "@/lib/voices";
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
function accessState(doc: Doc) {
  if (!doc.enabled) return "Disabled";
  if (doc.status === "failed") return "Needs attention";
  if (doc.status !== "ready") return "Preparing";
  if (Date.now() < doc.availableAt) return "Scheduled";
  if (Date.now() >= doc.expiresAt) return "Closed";
  return "Available now";
}
export default function Dashboard() {
  const [settings, setSettings] = useState<Settings>(),
    [user, setUser] = useState<Identity | null>(null),
    [loading, setLoading] = useState(true),
    [listLoading, setListLoading] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]),
    [selected, setSelected] = useState<string>(),
    [uploading, setUploading] = useState(false),
    [showUpload, setShowUpload] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All");
  const identityRef = useRef(user);
  identityRef.current = user;
  const refresh = useCallback(async () => {
    const identity = identityRef.current?.id;
    const result = await apiFetch<Doc[]>("/api/documents");
    if (identity && identity === identityRef.current?.id) setDocs(result);
  }, []);
  useEffect(() => {
    let disposed = false;
    Promise.all([
      apiFetch<Settings>("/api/config"),
      apiFetch<Identity>("/api/auth/me").catch(() => null),
    ])
      .then(([config, identity]) => {
        if (!disposed) {
          setSettings(config);
          setUser(identity);
        }
      })
      .catch((e) => !disposed && setError(e.message))
      .finally(() => !disposed && setLoading(false));
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    setListLoading(true);
    refresh()
      .catch((e) => !disposed && setError(e.message))
      .finally(() => !disposed && setListLoading(false));
    const timer = setInterval(
      () => refresh().catch((e) => !disposed && setError(e.message)),
      5000,
    );
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [user, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function login(account: string) {
    setLoading(true);
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
    } finally {
      setLoading(false);
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
          ? "Delete this assessment and its audio? This cannot be undone."
          : "Replace this link? Anyone using the old link will lose access.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        `/api/documents/${doc.id}${name === "delete" ? "" : "/" + name}`,
        jsonRequest(name === "delete" ? "DELETE" : "POST"),
      );
      await refresh();
      if (name === "delete") setSelected(undefined);
      setNotice(
        name === "delete"
          ? "Assessment deleted."
          : name === "rotate"
            ? "New student link created."
            : name === "disable"
              ? "Student access disabled."
              : "Preparing speech again.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = docs.find((d) => d.id === selected);
  const visible = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "All" || accessState(d) === filter),
  );
  return (
    <>
      <header className="app-header">
        <Brand />
        {user && (
          <div className="header-account">
            <span title={user.email}>{user.email}</span>
            <button
              className="text-button"
              onClick={async () => {
                await apiFetch("/api/auth/logout", jsonRequest("POST"));
                setUser(null);
                setDocs([]);
                setSelected(undefined);
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className={user ? "dashboard" : "sign-in-page"}>
        {error && (
          <div role="alert" className="alert error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
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
          <Loading className="page-loading" />
        ) : !user ? (
          <section className="sign-in-card">
            <img
              src="/brand/safe-online-exam-icon.png"
              alt=""
              width="64"
              height="64"
            />
            <h1>
              Safe Online Exam <span>Reader</span>
            </h1>
            {settings?.local ? (
              <>
                <p className="small muted">Local demo · prerecorded audio</p>
                <button className="primary" onClick={() => login("one")}>
                  Open demo workspace
                </button>
                <button className="text-button" onClick={() => login("two")}>
                  Use second demo account
                </button>
              </>
            ) : settings?.authConfigured ? (
              <a
                className="button google-sign-in"
                href={`${settings.origin}/api/auth/login`}
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 5-0.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.4 9.4 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z"
                  />
                </svg>
                Sign in with Google
              </a>
            ) : (
              <p className="setup-note">
                Google sign-in is not configured yet.
              </p>
            )}
          </section>
        ) : (
          <>
            <div className="page-heading">
              <h1>Your assessments</h1>
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setShowUpload(true);
                }}
              >
                + New assessment
              </button>
            </div>
            {settings?.local && (
              <p className="local-note">
                Local demo ·{" "}
                <a href="/fixture.pdf" download>
                  Download sample PDF
                </a>{" "}
                · other PDFs use mock audio
              </p>
            )}
            <div className={`workspace ${current ? "has-detail" : ""}`}>
              <div className="library-column">
                <div className="library-controls">
                  <input
                    type="search"
                    aria-label="Search assessments"
                    placeholder="Search assessments"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    aria-label="Filter assessments"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All",
                      "Available now",
                      "Scheduled",
                      "Closed",
                      "Disabled",
                      "Preparing",
                      "Needs attention",
                    ].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                  <small>
                    {visible.length}{" "}
                    {visible.length === 1 ? "assessment" : "assessments"}
                  </small>
                </div>
                <section
                  className="document-list"
                  aria-label="Your assessments"
                >
                  {listLoading ? (
                    <Loading
                      label="Loading assessments…"
                      className="list-loading"
                    />
                  ) : visible.length ? (
                    visible.map((doc) => (
                      <button
                        className={`document-row ${selected === doc.id ? "selected" : ""}`}
                        key={doc.id}
                        aria-pressed={selected === doc.id}
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
                              {formatTime(doc.availableAt, doc.timezone)}
                            </small>
                          </div>
                        </div>
                        <div className="document-state">
                          <span
                            className={`status ${doc.status === "ready" && doc.enabled ? "ready" : doc.status === "failed" || !doc.enabled ? "failed" : "working"}`}
                          >
                            {accessState(doc)}
                          </span>
                          {["queued", "processing"].includes(doc.status) && (
                            <progress
                              aria-label="Speech preparation"
                              value={doc.completedSegments}
                              max={doc.totalSegments || 1}
                            />
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h2>
                        {docs.length
                          ? "No matching assessments"
                          : "No assessments yet"}
                      </h2>
                      {!docs.length && (
                        <button
                          className="primary"
                          onClick={() => {
                            setError("");
                            setShowUpload(true);
                          }}
                        >
                          Upload a PDF
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </div>
              {current && (
                <DocumentDetail
                  key={current.id}
                  doc={current}
                  busy={busy}
                  onSave={async (data) => {
                    setBusy(true);
                    setError("");
                    try {
                      await apiFetch(
                        `/api/documents/${current.id}`,
                        jsonRequest("PATCH", data),
                      );
                      await refresh();
                      setNotice("Availability saved.");
                    } catch (e) {
                      setError((e as Error).message);
                      throw e;
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onAction={(name) => action(current, name)}
                  onClose={() => setSelected(undefined)}
                />
              )}
            </div>
          </>
        )}
        {showUpload && settings && (
          <UploadForm
            settings={settings}
            busy={uploading}
            error={error}
            onClose={() => !uploading && setShowUpload(false)}
            onUpload={async (form) => {
              setUploading(true);
              setError("");
              try {
                const doc = await apiFetch<Doc>("/api/documents", {
                  method: "POST",
                  body: form,
                });
                setSelected(doc.id);
                setSearch("");
                setFilter("All");
                setShowUpload(false);
                await refresh();
                setNotice("Preparing speech. You can keep working.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        )}
      </main>
    </>
  );
}
function UploadForm({
  settings,
  busy,
  error,
  onUpload,
  onClose,
}: {
  settings: Settings;
  busy: boolean;
  error: string;
  onUpload: (form: FormData) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(""),
    [window, setWindow] = useState({
      start: wallInput(Date.now(), settings.timezone),
      end: wallInput(Date.now() + 3600000, settings.timezone),
      timezone: settings.timezone,
    });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="upload-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="form-heading">
        <h2>New assessment</h2>
        <button aria-label="Close upload" disabled={busy} onClick={onClose}>
          ×
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onUpload(new FormData(e.currentTarget));
        }}
      >
        <fieldset disabled={busy} className="form-fields">
          <label className="upload-file">
            Assessment PDF
            <input
              type="file"
              aria-label="Assessment PDF"
              name="file"
              accept="application/pdf,.pdf"
              required
              onChange={(e) => {
                if (!title)
                  setTitle(
                    e.target.files?.[0]?.name.replace(/\.pdf$/i, "") || "",
                  );
              }}
            />
            <small>
              Digital PDF · up to {Math.round(settings.maxUpload / 1024 / 1024)}{" "}
              MB · {settings.maxPages} pages
            </small>
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
          <h3>Student access</h3>
          <WindowFields
            {...window}
            onChange={(key, value) =>
              setWindow((w) => ({ ...w, [key]: value }))
            }
          />
          <VoicePicker voices={settings.voices} />
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? (
                <Loading label="Uploading…" />
              ) : (
                "Upload & prepare speech"
              )}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
function DocumentDetail({
  doc,
  busy,
  onSave,
  onAction,
  onClose,
}: {
  doc: Doc;
  busy: boolean;
  onSave: (data: unknown) => Promise<void>;
  onAction: (name: "disable" | "rotate" | "retry" | "delete") => void;
  onClose: () => void;
}) {
  const [window, setWindow] = useState({
      start: wallInput(doc.availableAt, doc.timezone),
      end: wallInput(doc.expiresAt, doc.timezone),
      timezone: doc.timezone,
    }),
    [enabled, setEnabled] = useState(doc.enabled),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const share = useRef<HTMLInputElement>(null);
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
  const dirty =
    window.start !== wallInput(doc.availableAt, doc.timezone) ||
    window.end !== wallInput(doc.expiresAt, doc.timezone) ||
    window.timezone !== doc.timezone ||
    enabled !== doc.enabled;
  return (
    <aside className="detail-panel" aria-label="Assessment details">
      <div className="detail-heading">
        <div>
          <span
            className={`status ${doc.status === "ready" ? "ready" : "working"}`}
          >
            {doc.status === "ready"
              ? "Ready"
              : doc.status === "failed"
                ? "Needs attention"
                : "Preparing"}
          </span>
          <h2>{doc.title}</h2>
        </div>
        <button aria-label="Close assessment details" onClick={onClose}>
          ×
        </button>
      </div>
      {doc.status === "ready" ? (
        <div className="share-section">
          <button
            className="primary copy-link"
            onClick={async () => {
              setCopyError(false);
              try {
                await navigator.clipboard.writeText(doc.shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                setCopyError(true);
                share.current?.focus();
                share.current?.select();
              }
            }}
          >
            {copied ? "Link copied" : "Copy student link"}
          </button>
          <input
            ref={share}
            aria-label="Student share link"
            value={doc.shareUrl}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          {copyError && (
            <small role="alert">Select and copy the link above.</small>
          )}
        </div>
      ) : (
        doc.status !== "failed" && (
          <div className="preparing-summary">
            <Loading label="Preparing speech…" />
            <progress
              aria-label="Speech preparation"
              value={doc.completedSegments}
              max={doc.totalSegments || 1}
            />
            <small>
              {doc.totalSegments
                ? `${doc.completedSegments} of ${doc.totalSegments} passages`
                : "Reading the PDF"}
            </small>
          </div>
        )
      )}
      {doc.error && <div className="alert error">{doc.error}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...window, enabled }).catch(() => {});
        }}
      >
        <fieldset disabled={busy} className="form-fields">
          <div className="section-heading">
            <h3>Student access</h3>
            <span className="small muted">{accessState(doc)}</span>
          </div>
          <WindowFields
            {...window}
            onChange={(key, value) =>
              setWindow((w) => ({ ...w, [key]: value }))
            }
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Allow student access
          </label>
          <div className="save-row">
            <button className="primary" type="submit" disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save availability"}
            </button>
            {dirty && <small>Unsaved changes</small>}
            {doc.enabled && (
              <button
                type="button"
                className="danger text-button"
                onClick={() => onAction("disable")}
              >
                Disable now
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <div className="detail-bottom">
        <small>
          {doc.pages ? `${doc.pages} pages · ` : ""}
          {voiceLabel(doc.voice)} · {voiceInfo(doc.voice).family}
        </small>
        {doc.warnings.length > 0 && (
          <details className="review-notes">
            <summary>
              {doc.warnings.length} preview{" "}
              {doc.warnings.length === 1 ? "note" : "notes"}
            </summary>
            {doc.warnings.map((w) => (
              <p className="warning small" key={w}>
                {w}
              </p>
            ))}
          </details>
        )}
        <details className="more-options">
          <summary>More options</summary>
          <div className="document-actions">
            {doc.status === "failed" && (
              <button disabled={busy} onClick={() => onAction("retry")}>
                Retry processing
              </button>
            )}
            <button disabled={busy} onClick={() => onAction("rotate")}>
              Replace student link
            </button>
            <button
              disabled={busy}
              className="danger"
              onClick={() => onAction("delete")}
            >
              Delete assessment
            </button>
          </div>
        </details>
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
      </div>
    </aside>
  );
}
