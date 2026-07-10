import {
  Check,
  Circle,
  Clock,
  FilePlus2,
  Gauge,
  MapPin,
  Maximize2,
  Minimize2,
  PanelRight,
  PenLine,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  ScanText,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  addResponseCandidate,
  applySuggestionToDocument,
  buildPennyArtifactContext,
  clearSelectionFocus,
  createDocument,
  createInitialWorkspace,
  createPennyUndoSnapshot,
  deleteResponseCandidate,
  diffWords,
  getArtifactFreshness,
  getActiveDocument,
  insertInlineAnnotations,
  pinResponseCandidate,
  replaceDocumentTextWithSuggestion,
  restorePennyUndoSnapshot,
  selectResponseCandidate,
  setSelectionFocus,
  selectDocumentStyleProfile,
  selectMode,
  updateDocumentPositioningContext,
  updateDocumentText,
} from "./lib/workspaceState.js";
import { askPenny, checkPennyStyle, fetchPennyConfig, fetchRuntimeStatus, fetchWorkspace, runRuntimeAction, saveWorkspace } from "./lib/apiClient.js";
import { configurePennyProfiles, modeById, pennyModes, styleProfileById, styleProfiles } from "./lib/pennyModes.js";

function safeParseRuntime(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function RuntimeToolbar({ runtime, onAction, busy }) {
  const parsed = safeParseRuntime(runtime?.stdout || "");
  const profile = parsed?.state?.profile || parsed?.default_profile || "daily";
  const listener = parsed?.listener ? "online" : "offline";

  return (
    <header className="runtime-toolbar">
      <div className="brand-lockup">
        <div className="brand-mark">P</div>
        <div>
          <h1>Penny</h1>
          <p>Local writing workspace</p>
        </div>
      </div>
      <div className="runtime-cluster" aria-label="Local model runtime controls">
        <div className={`runtime-pill ${listener}`}>
          <Circle size={9} fill="currentColor" aria-hidden="true" />
          <span>{listener === "online" ? "Model online" : "Model offline"}</span>
        </div>
        <div className="segmented">
          <button className={profile === "daily" ? "active" : ""} onClick={() => onAction({ action: "swap", profile: "daily" })}>
            Daily
          </button>
          <button className={profile === "quality" ? "active" : ""} onClick={() => onAction({ action: "swap", profile: "quality" })}>
            Quality
          </button>
        </div>
        <button
          className="icon-button"
          title="Start daily model"
          aria-label="Start daily model"
          disabled={busy}
          onClick={() => onAction({ action: "start_daily" })}
        >
          <Play size={16} aria-hidden="true" />
        </button>
        <button className="icon-button" title="Stop model" aria-label="Stop model" disabled={busy} onClick={() => onAction({ action: "stop" })}>
          <Square size={15} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          title="Refresh status"
          aria-label="Refresh status"
          disabled={busy}
          onClick={() => onAction({ action: "status" })}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function ProjectRail({ workspace, activeDocument, onCreateDocument, onSelectDocument }) {
  const project = workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const newTitleRef = useRef(null);

  useEffect(() => {
    if (isCreating) newTitleRef.current?.focus();
  }, [isCreating]);

  function cancelCreate() {
    setIsCreating(false);
    setNewTitle("");
  }

  function submitCreate(event) {
    event.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) {
      cancelCreate();
      return;
    }
    onCreateDocument(trimmed);
    cancelCreate();
  }

  return (
    <aside className="project-rail">
      <div className="rail-section-title">Writing</div>
      {isCreating ? (
        <form className="new-doc-form" onSubmit={submitCreate}>
          <input
            ref={newTitleRef}
            className="new-doc-input"
            name="newPieceTitle"
            autoComplete="off"
            value={newTitle}
            placeholder="Title for the new piece…"
            aria-label="New piece title"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancelCreate();
            }}
          />
          <div className="new-doc-form-actions">
            <button type="submit" className="new-doc-confirm">
              <Check size={15} aria-hidden="true" />
              Create
            </button>
            <button type="button" className="new-doc-cancel" onClick={cancelCreate}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="new-doc-button" onClick={() => setIsCreating(true)}>
          <FilePlus2 size={16} aria-hidden="true" />
          New piece
        </button>
      )}
      <nav className="document-list" aria-label="Writing projects">
        {project.documents.map((document) => (
          <button
            key={document.id}
            className={document.id === activeDocument.id ? "document-item active" : "document-item"}
            onClick={() => onSelectDocument(document.id)}
          >
            <span>{document.title}</span>
            <small>{document.writingType}</small>
          </button>
        ))}
      </nav>
      <div className="rail-footer">
        <Gauge size={16} aria-hidden="true" />
        <span>Local only</span>
      </div>
    </aside>
  );
}

function countWords(text = "") {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function selectedRangeFromState(document, selectedText, selectionStart, selectionEnd) {
  if (!selectedText || !Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) return null;
  if (selectionEnd <= selectionStart) return null;
  if (document.body.slice(selectionStart, selectionEnd) !== selectedText) return null;
  return { start: selectionStart, end: selectionEnd, kind: "selection" };
}

function renderMirrorText(text, range) {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end <= range.start) {
    return text || "\n";
  }
  const safeStart = Math.max(0, Math.min(range.start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(range.end, text.length));
  return (
    <>
      {text.slice(0, safeStart)}
      <mark className={range.kind === "anchor" ? "anchor-highlight" : "selection-highlight"}>{text.slice(safeStart, safeEnd)}</mark>
      {text.slice(safeEnd) || "\n"}
    </>
  );
}

function EditorCanvas({
  document,
  onUpdateBody,
  selectedText,
  selectionStart,
  selectionEnd,
  onSelectedText,
  onSelectionAction,
  anchorFocus,
}) {
  const textareaRef = useRef(null);
  const mirrorRef = useRef(null);
  const selectedRange = selectedRangeFromState(document, selectedText, selectionStart, selectionEnd);
  const highlightRange = anchorFocus || selectedRange;

  useEffect(() => {
    if (!anchorFocus || !textareaRef.current) return;
    const textarea = textareaRef.current;
    const safeStart = Math.max(0, Math.min(anchorFocus.start, textarea.value.length));
    const ratio = textarea.value.length ? safeStart / textarea.value.length : 0;
    textarea.scrollTop = Math.max(0, (textarea.scrollHeight - textarea.clientHeight) * ratio);
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = textarea.scrollTop;
      mirrorRef.current.scrollLeft = textarea.scrollLeft;
    }
  }, [anchorFocus]);

  function handleSelect(event) {
    if (globalThis.document?.activeElement !== event.currentTarget) return;
    const { selectionStart: start, selectionEnd: end, value } = event.currentTarget;
    onSelectedText({
      text: value.substring(start, end),
      start,
      end,
    });
  }

  function handleScroll(event) {
    if (!mirrorRef.current) return;
    mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
    mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
  }

  const selectedWords = countWords(selectedText);

  return (
    <main className="editor-shell">
      <div className="editor-meta">
        <span>{document.writingType}</span>
        <span>{document.body.length.toLocaleString()} chars</span>
      </div>
      <h2 className="document-title">{document.title}</h2>
      <div className="editor-canvas-wrap">
        <pre ref={mirrorRef} className="document-editor-mirror" aria-hidden="true">
          {renderMirrorText(document.body, highlightRange)}
        </pre>
        <textarea
          ref={textareaRef}
          className="document-editor"
          value={document.body}
          onChange={(event) => onUpdateBody(event.target.value)}
          onSelect={handleSelect}
          onScroll={handleScroll}
          aria-label="Writing draft"
        />
      </div>
      {selectedText ? (
        <div className="selection-popover" aria-label="Selected text actions">
          <button type="button" onClick={() => onSelectionAction("ask")}>
            Ask About This
          </button>
          <button type="button" onClick={() => onSelectionAction("revise")}>
            Revise This
          </button>
          <button type="button" onClick={() => onSelectionAction("note")}>
            Note Here
          </button>
        </div>
      ) : null}
      <div className="selection-strip">
        <PenLine size={15} aria-hidden="true" />
        <span>
          {selectedText
            ? `Selected ${selectedWords.toLocaleString()} words / ${selectedText.length.toLocaleString()} chars: ${selectedText.slice(0, 96)}`
            : "Select text to focus Penny on a passage."}
        </span>
      </div>
    </main>
  );
}

function ModeGrid({ selectedModeId, onSelectMode }) {
  return (
    <div className="mode-grid" aria-label="Penny writing modes">
      {pennyModes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          aria-pressed={mode.id === selectedModeId}
          className={mode.id === selectedModeId ? "mode-card active" : "mode-card"}
          onClick={() => onSelectMode(mode.id)}
        >
          <span>{mode.label}</span>
          <small>{mode.description}</small>
        </button>
      ))}
    </div>
  );
}

function VoiceReport({ report, onFocusFinding }) {
  if (!report) return null;
  const topIssues = report.violations?.slice(0, 3) || [];
  const layerEntries = Object.entries(report.styleFindings?.byLayer || {});
  const anchoredFindings = layerEntries
    .flatMap(([layer, findings]) =>
      findings.map((finding) => ({
        ...finding,
        layer,
      })),
    )
    .filter((finding) => Number.isInteger(finding.index) && Number.isInteger(finding.endIndex) && finding.endIndex > finding.index)
    .slice(0, 6);

  return (
    <section className={`voice-report ${report.summary?.status || "revise"}`} aria-label="Voice report">
      <div className="voice-report-head">
        <div>
          <span>Voice score</span>
          <strong>{report.voiceScore}</strong>
        </div>
        <small>{report.summary?.label || "heuristic check"}</small>
      </div>
      <div className="voice-report-grid">
        <span>Mode</span>
        <b>{report.mode?.replaceAll("_", " ")}</b>
        <span>Missing</span>
        <b>{report.detectedSlots?.missing?.join(", ") || "none"}</b>
      </div>
      {layerEntries.length ? (
        <div className="style-layer-list" aria-label="Style finding layers">
          {layerEntries.map(([layer, findings]) => (
            <span key={layer}>
              {layer} {findings.length}
            </span>
          ))}
        </div>
      ) : null}
      {topIssues.length ? (
        <ul className="voice-issues">
          {topIssues.map((issue) => (
            <li key={issue.ruleId}>
              <span>{issue.layer ? `${issue.layer} / ${issue.ruleId}` : issue.ruleId}</span>
              {issue.fix}
            </li>
          ))}
        </ul>
      ) : (
        <p className="voice-note">No critical voice issues detected.</p>
      )}
      {report.styleFindings?.byLayer?.AIVoice?.length ? (
        <p className="voice-note">
          AI-voice checks are advisory. Use them to revise concrete wording; human review still owns truth, evidence, tone, and readiness.
        </p>
      ) : null}
      {anchoredFindings.length ? (
        <div className="voice-anchor-list" aria-label="Voice finding anchors">
          {anchoredFindings.map((finding, index) => (
            <button
              key={`${finding.layer}-${finding.ruleId}-${finding.index}-${index}`}
              type="button"
              onClick={() => onFocusFinding?.({ start: finding.index, end: finding.endIndex, label: finding.ruleId })}
            >
              <MapPin size={13} aria-hidden="true" />
              <span>{finding.ruleId || finding.layer}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="voice-note">{report.calibrationNote || "Heuristic editing signal, not authorship proof."}</p>
    </section>
  );
}

function formatVoiceMode(mode) {
  return mode?.replaceAll("_", " ") || "not scored";
}

function freshnessLabel(freshness) {
  if (freshness?.fresh) return "Current";
  const reasons = freshness?.reasons?.length ? freshness.reasons.join(", ") : "unknown context";
  return `Stale: ${reasons}`;
}

function replacementSourceText(response, document) {
  if (!response) return "";
  if (response.revisionScope === "selection") return response.context?.selectedText || "";
  if (response.context?.selectedText) return response.context.selectedText;
  return document.body || "";
}

function renderWordDiff(original, proposed) {
  const parts = diffWords(original, proposed);
  if (!parts.length) return <span className="diff-empty">No word-level changes detected.</span>;
  return parts.map((part, index) => (
    <span key={`${part.type}-${index}`} className={`diff-part ${part.type}`}>
      {part.text}
    </span>
  ));
}

function PennyReviewSurface({
  mode,
  document,
  latestResponse,
  latestStyleReport,
  responseFreshness,
  styleFreshness,
  reviewStatus,
  latestResponseRef,
  onApplyReplacement,
  onApplyVoiceRevision,
  onDraftInlineAnnotations,
  onApplyInlineAnnotations,
  onDiscardResponse,
  onInsert,
  onUndo,
  undoSnapshot,
  onCancelRequest,
  requestProgress,
  onFocusAnchor,
  onFocusFinding,
  onRefineResponse,
  annotationInstruction,
  onAnnotationInstruction,
  refineInstruction,
  onRefineInstruction,
  busy,
  isFocused,
  onOpenFocus,
  onCloseFocus,
}) {
  const focusToggleRef = useRef(null);
  const hasResponse = Boolean(latestResponse?.content);
  const hasReport = Boolean(latestStyleReport);
  const hasStatus = Boolean(reviewStatus?.message);
  const [activeTab, setActiveTab] = useState(hasResponse ? "revision" : "evaluation");

  useEffect(() => {
    if (hasResponse) {
      setActiveTab("revision");
    } else if (hasReport) {
      setActiveTab("evaluation");
    }
  }, [hasResponse, latestResponse?.content, hasReport, latestStyleReport?.voiceScore]);

  useEffect(() => {
    if (!isFocused) return undefined;
    const previousFocus = globalThis.document?.activeElement;
    requestAnimationFrame(() => focusToggleRef.current?.focus());
    function handleEscape(event) {
      if (event.key === "Escape") onCloseFocus();
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      if (previousFocus instanceof HTMLElement) {
        requestAnimationFrame(() => previousFocus.focus());
      }
    };
  }, [isFocused, onCloseFocus]);

  const canFocusReview = hasResponse || hasReport;
  const activeFreshness = hasResponse ? responseFreshness : styleFreshness;
  const responseIsFresh = responseFreshness?.fresh !== false;
  const styleIsFresh = styleFreshness?.fresh !== false;
  const surfaceClassName = [
    "review-surface",
    hasResponse ? "with-response" : "",
    hasReport ? "with-report" : "",
    activeFreshness?.fresh === false ? "stale" : "",
    isFocused ? "focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!hasResponse && !hasReport && !hasStatus) {
    return (
      <section className="review-surface empty" aria-label="Penny review surface">
        <div className="empty-review">
          <Wand2 size={18} aria-hidden="true" />
          <p>Run a voice check or ask Penny to review the current draft.</p>
        </div>
      </section>
    );
  }
  if (!hasResponse && !hasReport && hasStatus) {
    return (
      <section ref={latestResponseRef} className="review-surface status-only" aria-label="Penny review surface" aria-live="polite">
        <div className="review-surface-head">
          <div>
            <span className="eyebrow">Penny Review</span>
            <h3>{reviewStatus.kind === "pending" ? "Checking Voice" : "Review Status"}</h3>
          </div>
        </div>
        <p className={`review-status ${reviewStatus.kind || "info"}`}>{reviewStatus.message}</p>
        {undoSnapshot ? (
          <button type="button" className="undo-change-button" onClick={onUndo}>
            <Undo2 size={15} aria-hidden="true" />
            Undo Penny change
          </button>
        ) : null}
        {requestProgress ? (
          <div className="request-progress" aria-live="polite">
            <Clock size={14} aria-hidden="true" />
            <span>
              {requestProgress.label} · {requestProgress.elapsedSeconds || 0}s
            </span>
            <button type="button" onClick={onCancelRequest}>
              <Square size={13} aria-hidden="true" />
              Cancel
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  const scopeLabel = latestResponse?.revisionScope === "selection" ? "Selected passage" : "Full draft";
  const isReplacement = latestResponse?.applyMode === "replace";
  const isAnnotation = latestResponse?.applyMode === "annotate";
  const isOffline = Boolean(latestResponse?.offline);
  const responseStyleReport = isAnnotation ? latestStyleReport : latestResponse?.responseStyleReport || latestStyleReport;
  const inlineAnnotations = latestResponse?.inlineAnnotations || [];
  const canMutateResponse = !busy && !isOffline && responseIsFresh;
  const canMutateStyleReport = !busy && styleIsFresh;
  const originalText = isReplacement ? replacementSourceText(latestResponse, document) : "";
  const tabs = [
    hasResponse
      ? { id: "revision", label: isAnnotation ? "Inline Notes" : isReplacement ? "Revision" : "Suggestion" }
      : null,
    hasReport ? { id: "evaluation", label: "Evaluation" } : null,
    hasResponse || hasReport ? { id: "details", label: "Details" } : null,
  ].filter(Boolean);
  const selectedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0].id;
  const score = responseStyleReport?.voiceScore ?? "n/a";
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedTab);
  const reviewTitle = isOffline
    ? "Runtime Note"
    : isAnnotation
      ? "Inline Notes Preview"
      : isReplacement
      ? "Replacement Preview"
      : hasResponse
        ? "Latest Suggestion"
        : "Voice Evaluation";

  function focusTab(tabId) {
    requestAnimationFrame(() => {
      latestResponseRef.current?.querySelector(`[data-review-tab="${tabId}"]`)?.focus();
    });
  }

  function handleTabKeyDown(event) {
    const tabCount = tabs.length;
    if (!tabCount) return;
    let nextIndex = selectedIndex;
    if (event.key === "ArrowRight") nextIndex = (selectedIndex + 1) % tabCount;
    if (event.key === "ArrowLeft") nextIndex = (selectedIndex - 1 + tabCount) % tabCount;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabCount - 1;
    if (nextIndex === selectedIndex) return;
    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    focusTab(tabs[nextIndex].id);
  }

  return (
    <section
      ref={latestResponseRef}
      className={surfaceClassName}
      aria-label="Penny review surface"
      aria-live="polite"
      role={isFocused ? "dialog" : undefined}
      aria-modal={isFocused ? "true" : undefined}
      aria-labelledby={isFocused ? "penny-review-heading" : undefined}
    >
      <div className="review-surface-head">
        <div>
          <span className="eyebrow">Penny Review</span>
          <h3 id="penny-review-heading">{reviewTitle}</h3>
        </div>
        <div className="review-head-actions">
          <span className="review-score">Score {score}</span>
          {canFocusReview ? (
            <button
              ref={focusToggleRef}
              type="button"
              className="icon-button review-focus-button"
              title={isFocused ? "Close focus view" : "Open focus view"}
              aria-label={isFocused ? "Close focus view" : "Open focus view"}
              onClick={isFocused ? onCloseFocus : onOpenFocus}
            >
              {isFocused ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>
      {hasStatus ? <p className={`review-status ${reviewStatus.kind || "info"}`}>{reviewStatus.message}</p> : null}
      {requestProgress ? (
        <div className="request-progress" aria-live="polite">
          <Clock size={14} aria-hidden="true" />
          <span>
            {requestProgress.label} · {requestProgress.elapsedSeconds || 0}s
          </span>
          <button type="button" onClick={onCancelRequest}>
            <Square size={13} aria-hidden="true" />
            Cancel
          </button>
        </div>
      ) : null}
      {activeFreshness?.fresh === false ? (
        <p className="stale-badge" role="status">
          {freshnessLabel(activeFreshness)}. Review remains visible, but unsafe apply actions are blocked.
        </p>
      ) : null}
      {undoSnapshot ? (
        <button type="button" className="undo-change-button" onClick={onUndo}>
          <Undo2 size={15} aria-hidden="true" />
          Undo Penny change
        </button>
      ) : null}
      <div className="review-tabs" role="tablist" aria-label="Penny review views" onKeyDown={handleTabKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`penny-review-tab-${tab.id}`}
            data-review-tab={tab.id}
            type="button"
            role="tab"
            aria-selected={selectedTab === tab.id}
            aria-controls={`penny-review-panel-${tab.id}`}
            className={selectedTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {selectedTab === "revision" && hasResponse ? (
        <div
          id="penny-review-panel-revision"
          className="review-panel revision-panel"
          role="tabpanel"
          aria-labelledby="penny-review-tab-revision"
        >
          {!isOffline ? (
            <div className="review-meta-row">
              <span>{mode.label}</span>
              <span>{styleProfileById(latestResponse.styleProfileId || document.styleProfileId).label}</span>
              {isReplacement ? <span>{scopeLabel}</span> : null}
              {isAnnotation ? <span>{inlineAnnotations.length} notes</span> : null}
            </div>
          ) : null}
          {isAnnotation ? (
            <>
              {latestResponse.sourceResponse?.content ? (
                <div className="annotation-source-context">
                  <span>Source Penny response</span>
                  <p>{latestResponse.sourceResponse.content}</p>
                </div>
              ) : null}
              <div className="annotation-preview-list">
                {inlineAnnotations.map((annotation, index) => (
                  <article key={`${annotation.anchorText}-${index}`} className="annotation-preview-item">
                    <div>
                      <span>Target {index + 1}</span>
                      <button type="button" className="anchor-preview-button" onClick={() => onFocusAnchor(annotation.anchorText)}>
                        <MapPin size={13} aria-hidden="true" />
                        {annotation.position === "before" ? "Before" : "After"}
                      </button>
                    </div>
                    <blockquote>{annotation.anchorText}</blockquote>
                    <p>{annotation.note}</p>
                  </article>
                ))}
              </div>
            </>
          ) : isReplacement ? (
            <div className="replacement-compare">
              <section className="replacement-block">
                <span>Before · {scopeLabel}</span>
                <p>{originalText}</p>
              </section>
              <section className="replacement-block proposed">
                <span>Proposed</span>
                <p>{latestResponse.content}</p>
              </section>
              <details className="word-diff-view" open>
                <summary>Word-level diff</summary>
                <div>{renderWordDiff(originalText, latestResponse.content)}</div>
              </details>
            </div>
          ) : (
            <div className={isOffline ? "revision-output runtime-note" : "revision-output"}>
              <p>{latestResponse.content}</p>
            </div>
          )}
          {!isOffline && isReplacement ? (
            <div className="review-action-bar">
              <button type="button" className="insert-button" disabled={!canMutateResponse} onClick={() => onApplyReplacement(latestResponse)}>
                <Check size={15} aria-hidden="true" />
                Apply in place
              </button>
              <button type="button" className="discard-button" onClick={onDiscardResponse}>
                Discard
              </button>
            </div>
          ) : null}
          {!isOffline && isAnnotation ? (
            <div className="review-action-bar">
              <button type="button" className="insert-button" disabled={!canMutateResponse} onClick={() => onApplyInlineAnnotations(latestResponse)}>
                <Check size={15} aria-hidden="true" />
                Insert inline notes
              </button>
              <button type="button" className="discard-button" onClick={onDiscardResponse}>
                Discard
              </button>
            </div>
          ) : null}
          {!isOffline && !isReplacement && !isAnnotation ? (
            <div className="review-action-bar">
              <button type="button" className="insert-button" disabled={!canMutateResponse} onClick={() => onInsert(latestResponse)}>
                <Check size={15} aria-hidden="true" />
                Insert into draft
              </button>
            </div>
          ) : null}
          {!isOffline && !isAnnotation ? (
            <div className="refine-composer">
              <label>
                <span>Refine this response</span>
                <textarea
                  name="pennyRefineInstruction"
                  autoComplete="off"
                  value={refineInstruction}
                  onChange={(event) => onRefineInstruction(event.target.value)}
                  placeholder="Example: keep the direction, but make it more direct and less polished."
                />
              </label>
              <button
                type="button"
                className="draft-inline-button"
                disabled={busy || !latestResponse?.content || !refineInstruction.trim()}
                onClick={() => onRefineResponse(latestResponse, refineInstruction)}
              >
                {busy ? <RefreshCw size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
                Refine
              </button>
            </div>
          ) : null}
          {!isOffline ? (
            <div className="annotation-composer">
              <label>
                <span>How should Penny apply this?</span>
                <textarea
                  name="inlineAnnotationInstruction"
                  autoComplete="off"
                  value={annotationInstruction}
                  onChange={(event) => onAnnotationInstruction(event.target.value)}
                  placeholder="Example: apply points 1 and 3 as bracketed notes where I should revise manually."
                />
              </label>
              <button
                type="button"
                className="draft-inline-button"
                disabled={busy || !latestResponse?.content}
                onClick={() => onDraftInlineAnnotations(latestResponse.sourceResponse || latestResponse, annotationInstruction)}
              >
                {busy ? <RefreshCw size={15} className="spin" aria-hidden="true" /> : <PenLine size={15} aria-hidden="true" />}
                {isAnnotation ? "Redraft inline notes" : "Draft inline notes"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedTab === "evaluation" && hasReport ? (
        <div
          id="penny-review-panel-evaluation"
          className="review-panel evaluation-panel"
          role="tabpanel"
          aria-labelledby="penny-review-tab-evaluation"
        >
          <VoiceReport report={latestStyleReport} onFocusFinding={onFocusFinding} />
          {!hasResponse ? (
            <div className="review-action-bar">
              <button type="button" className="insert-button" disabled={!canMutateStyleReport} onClick={onApplyVoiceRevision}>
                {busy ? <RefreshCw size={15} className="spin" aria-hidden="true" /> : <Wand2 size={15} aria-hidden="true" />}
                Apply voice revision
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedTab === "details" ? (
        <div
          id="penny-review-panel-details"
          className="review-panel details-panel"
          role="tabpanel"
          aria-labelledby="penny-review-tab-details"
        >
          <dl>
            <div>
              <dt>Document</dt>
              <dd>{document.title}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{mode.label}</dd>
            </div>
            <div>
              <dt>Style</dt>
              <dd>{styleProfileById(latestResponse?.styleProfileId || document.styleProfileId).label}</dd>
            </div>
            <div>
              <dt>Voice mode</dt>
              <dd>{formatVoiceMode(responseStyleReport?.mode || latestStyleReport?.mode)}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{isReplacement ? scopeLabel : isAnnotation ? "Inline notes" : "Suggestion"}</dd>
            </div>
          </dl>
          <p>{responseStyleReport?.calibrationNote || latestStyleReport?.calibrationNote || "Heuristic editing signal, not authorship proof."}</p>
        </div>
      ) : null}
    </section>
  );
}

function StyleProfilePicker({ document, onStyleProfile }) {
  const activeProfile = styleProfileById(document.styleProfileId);

  return (
    <label className="style-picker">
      <span>Style profile</span>
      <select name="styleProfile" autoComplete="off" value={activeProfile.id} onChange={(event) => onStyleProfile(event.target.value)}>
        {!activeProfile.available ? <option value={activeProfile.id}>{activeProfile.label}</option> : null}
        {styleProfiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.label}
          </option>
        ))}
      </select>
      <small>{activeProfile.description}</small>
    </label>
  );
}

function PositioningContextEditor({ document, onPositioningContext }) {
  const activeProfile = styleProfileById(document.styleProfileId);
  if (!activeProfile.capabilities?.includes("positioning_context")) return null;

  const context = document.positioningContext || {};
  const fields = [
    ["targetRoleFamily", "Target role family"],
    ["opportunityType", "Opportunity type"],
    ["audience", "Audience"],
    ["posture", "Posture"],
    ["evidenceEmphasis", "Evidence emphasis"],
    ["boundaries", "Boundaries"],
  ];

  return (
    <div className="positioning-context" aria-label="Positioning context">
      {fields.map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <textarea
            name={`positioning-${key}`}
            autoComplete="off"
            rows={2}
            value={context[key] || ""}
            onChange={(event) => onPositioningContext({ [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function SelectionFocusCard({ selectedText, selectionStart, selectionEnd, documentTitle, onClear, onAction }) {
  if (!selectedText) {
    return (
      <div className="selection-focus-card full-draft">
        <span>Scope</span>
        <strong>Using full draft</strong>
        <small>{documentTitle}</small>
      </div>
    );
  }

  const words = countWords(selectedText);
  const rangeLabel =
    Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)
      ? `${selectionStart.toLocaleString()}-${selectionEnd.toLocaleString()}`
      : "range unavailable";

  return (
    <div className="selection-focus-card">
      <div className="selection-focus-head">
        <div>
          <span>Selected scope</span>
          <strong>
            {words.toLocaleString()} words · {selectedText.length.toLocaleString()} chars
          </strong>
        </div>
        <button type="button" className="icon-button" title="Clear selection focus" aria-label="Clear selection focus" onClick={onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <p>{selectedText}</p>
      <small>Draft range {rangeLabel}</small>
      <div className="selection-chip-actions">
        <button type="button" onClick={() => onAction("ask")}>
          Ask About This
        </button>
        <button type="button" onClick={() => onAction("revise")}>
          Revise This
        </button>
        <button type="button" onClick={() => onAction("note")}>
          Note Here
        </button>
      </div>
    </div>
  );
}

function ResponseCandidateList({ candidates = [], onRestore, onPin, onDelete }) {
  if (!candidates.length) return null;
  return (
    <section className="response-candidates" aria-label="Saved Penny responses">
      <div className="candidate-list-head">
        <span>Saved responses</span>
        <small>{candidates.length}/8</small>
      </div>
      <div className="candidate-list">
        {candidates.map((candidate, index) => (
          <article key={candidate.id} className={candidate.pinned ? "candidate-card pinned" : "candidate-card"}>
            <button type="button" className="candidate-restore" onClick={() => onRestore(candidate.id)}>
              <span>{index === 0 ? "Latest" : candidate.pinned ? "Pinned" : "Previous"}</span>
              <strong>{candidate.content.slice(0, 96) || "Penny response"}</strong>
            </button>
            <div className="candidate-actions">
              <button
                type="button"
                className="icon-button"
                title={candidate.pinned ? "Unpin response" : "Pin response"}
                aria-label={candidate.pinned ? "Unpin response" : "Pin response"}
                onClick={() => onPin(candidate.id, !candidate.pinned)}
              >
                {candidate.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete response"
                aria-label="Delete response"
                onClick={() => onDelete(candidate.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PennyPanel({
  workspace,
  document,
  selectedText,
  selectionStart,
  selectionEnd,
  onMode,
  onStyleProfile,
  onPositioningContext,
  onInstruction,
  onClearSelection,
  onSelectionAction,
  onAsk,
  onCheckVoice,
  onApplyVoiceRevision,
  onApplyReplacement,
  onDraftInlineAnnotations,
  onApplyInlineAnnotations,
  onDiscardResponse,
  onInsert,
  onUndo,
  undoSnapshot,
  onCancelRequest,
  requestProgress,
  onFocusAnchor,
  onFocusFinding,
  onRefineResponse,
  onRestoreCandidate,
  onPinCandidate,
  onDeleteCandidate,
  annotationInstruction,
  onAnnotationInstruction,
  refineInstruction,
  onRefineInstruction,
  busy,
  latestResponse,
  latestStyleReport,
  responseFreshness,
  styleFreshness,
  reviewStatus,
  latestResponseRef,
}) {
  const mode = modeById(workspace.selectedModeId);
  const hasReview = Boolean(latestResponse?.content || latestStyleReport || reviewStatus?.message);
  const [isReviewFocused, setIsReviewFocused] = useState(false);
  const instructionPlaceholder =
    styleProfileById(document.styleProfileId).capabilities?.includes("positioning_context")
      ? "Example: sharpen this for a retained search partner evaluating me for a platform transformation role."
      : "Example: make this sharper without making it sound polished to death.";

  useEffect(() => {
    if (!hasReview) setIsReviewFocused(false);
  }, [hasReview]);

  const reviewSurface = (
    <div className={hasReview ? "response-stack active-review" : "response-stack"}>
      <PennyReviewSurface
        mode={mode}
        document={document}
        latestResponse={latestResponse}
        latestStyleReport={latestStyleReport}
        responseFreshness={responseFreshness}
        styleFreshness={styleFreshness}
        reviewStatus={reviewStatus}
        latestResponseRef={latestResponseRef}
        onApplyReplacement={onApplyReplacement}
        onApplyVoiceRevision={onApplyVoiceRevision}
        onDraftInlineAnnotations={onDraftInlineAnnotations}
        onApplyInlineAnnotations={onApplyInlineAnnotations}
        onDiscardResponse={onDiscardResponse}
        onInsert={onInsert}
        onUndo={onUndo}
        undoSnapshot={undoSnapshot}
        onCancelRequest={onCancelRequest}
        requestProgress={requestProgress}
        onFocusAnchor={onFocusAnchor}
        onFocusFinding={onFocusFinding}
        onRefineResponse={onRefineResponse}
        annotationInstruction={annotationInstruction}
        onAnnotationInstruction={onAnnotationInstruction}
        refineInstruction={refineInstruction}
        onRefineInstruction={onRefineInstruction}
        busy={busy}
        isFocused={isReviewFocused}
        onOpenFocus={() => setIsReviewFocused(true)}
        onCloseFocus={() => setIsReviewFocused(false)}
      />
    </div>
  );

  const controls = (
    <div className="penny-controls">
      <ModeGrid selectedModeId={workspace.selectedModeId} onSelectMode={onMode} />
      <StyleProfilePicker document={document} onStyleProfile={onStyleProfile} />
      <PositioningContextEditor document={document} onPositioningContext={onPositioningContext} />
      <SelectionFocusCard
        selectedText={selectedText}
        selectionStart={selectionStart}
        selectionEnd={selectionEnd}
        documentTitle={document.title}
        onClear={onClearSelection}
        onAction={onSelectionAction}
      />
      <label className="instruction-box">
        <span>What should Penny do?</span>
        <textarea
          name="pennyInstruction"
          autoComplete="off"
          value={workspace.instruction || ""}
          onChange={(event) => onInstruction(event.target.value)}
          placeholder={instructionPlaceholder}
        />
      </label>
      <div className="panel-status">
        <span>{selectedText ? "Focused on selected text" : "Using full draft"}</span>
        <span>{document.title}</span>
      </div>
      {requestProgress ? (
        <div className="request-progress compact" aria-live="polite">
          <Clock size={14} aria-hidden="true" />
          <span>
            {requestProgress.label} · {requestProgress.elapsedSeconds || 0}s
          </span>
          <button type="button" onClick={onCancelRequest}>
            <Square size={13} aria-hidden="true" />
            Cancel
          </button>
        </div>
      ) : null}
      <div className="voice-actions">
        <button type="button" className="check-button" disabled={busy} onClick={onCheckVoice}>
          {busy ? <RefreshCw size={17} className="spin" aria-hidden="true" /> : <ScanText size={17} aria-hidden="true" />}
          Check voice
        </button>
        <button type="button" className="ask-button" disabled={busy} onClick={onAsk}>
          {busy ? <RefreshCw size={17} className="spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          Ask Penny
        </button>
        <button type="button" className="apply-voice-button" disabled={busy} onClick={onApplyVoiceRevision}>
          {busy ? <RefreshCw size={17} className="spin" aria-hidden="true" /> : <Wand2 size={17} aria-hidden="true" />}
          Apply voice revision
        </button>
      </div>
    </div>
  );

  return (
    <aside className={hasReview ? "penny-panel review-mode" : "penny-panel compose-mode"}>
      <div className="panel-heading">
        <div>
          <h2>Penny</h2>
          <p>{mode.profile === "quality" ? "Quality specialist pass" : "Daily writing collaborator"}</p>
        </div>
        <PanelRight size={19} aria-hidden="true" />
      </div>
      {hasReview ? reviewSurface : null}
      {hasReview ? (
        <details className="penny-controls-drawer">
          <summary>
            <span>Writing controls</span>
            <SlidersHorizontal size={16} aria-hidden="true" />
          </summary>
          {controls}
        </details>
      ) : (
        controls
      )}
      <ResponseCandidateList
        candidates={document.pennyResponses || []}
        onRestore={onRestoreCandidate}
        onPin={onPinCandidate}
        onDelete={onDeleteCandidate}
      />
      {!hasReview ? reviewSurface : null}
    </aside>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState(() => createInitialWorkspace());
  const [runtime, setRuntime] = useState(null);
  const [busy, setBusy] = useState(false);
  const [latestResponse, setLatestResponse] = useState(null);
  const [latestStyleReport, setLatestStyleReport] = useState(null);
  const [reviewStatus, setReviewStatus] = useState(null);
  const [annotationInstruction, setAnnotationInstruction] = useState("");
  const [refineInstruction, setRefineInstruction] = useState("");
  const [pennyUndo, setPennyUndo] = useState(null);
  const [requestProgress, setRequestProgress] = useState(null);
  const [anchorFocus, setAnchorFocus] = useState(null);
  const [loadNote, setLoadNote] = useState("Loading local workspace...");
  const latestResponseRef = useRef(null);
  const workspaceDirtyRef = useRef(false);
  const requestControllerRef = useRef(null);

  const activeDocument = useMemo(() => getActiveDocument(workspace), [workspace]);
  const artifactContext = useMemo(() => buildPennyArtifactContext(workspace, activeDocument), [workspace, activeDocument]);
  const responseFreshness = useMemo(() => getArtifactFreshness(latestResponse, workspace), [latestResponse, workspace]);
  const styleFreshness = useMemo(() => getArtifactFreshness(latestStyleReport, workspace), [latestStyleReport, workspace]);

  useEffect(() => {
    Promise.all([fetchPennyConfig(), fetchWorkspace()])
      .then(([config, remoteWorkspace]) => {
        configurePennyProfiles(config.styleProfiles, config.defaultStyleProfileId);
        if (workspaceDirtyRef.current) {
          setLoadNote("Using active local workspace.");
          return;
        }
        setWorkspace({ ...createInitialWorkspace(), ...remoteWorkspace });
        setLoadNote("Workspace saved under runtime/penny.");
      })
      .catch(() => setLoadNote("Using unsaved local browser state."));
    refreshRuntime();
  }, []);

  useEffect(() => {
    if (!requestProgress?.startedAt || !busy) return undefined;
    const timer = window.setInterval(() => {
      setRequestProgress((current) =>
        current ? { ...current, elapsedSeconds: Math.floor((Date.now() - current.startedAt) / 1000) } : current,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy, requestProgress?.startedAt]);

  useEffect(() => {
    if (!anchorFocus) return undefined;
    const timer = window.setTimeout(() => setAnchorFocus(null), 2400);
    return () => window.clearTimeout(timer);
  }, [anchorFocus]);

  useEffect(() => {
    if (latestResponse?.content || latestStyleReport || reviewStatus?.message) {
      latestResponseRef.current?.closest(".penny-panel")?.scrollTo({ top: 0, behavior: "auto" });
      latestResponseRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [latestResponse?.content, latestStyleReport, reviewStatus]);

  useEffect(() => {
    function handleShortcut(event) {
      const commandKey = event.metaKey || event.ctrlKey;
      if (!commandKey || busy) return;
      if (event.key === "Enter") {
        event.preventDefault();
        handleAskPenny();
      }
      if (event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handleCheckVoice();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, workspace, activeDocument]);

  function persist(nextWorkspace) {
    workspaceDirtyRef.current = true;
    setWorkspace(nextWorkspace);
    saveWorkspace(nextWorkspace).catch(() => setLoadNote("Could not save to runtime/penny yet."));
  }

  function persistWith(updater) {
    workspaceDirtyRef.current = true;
    setWorkspace((current) => {
      const nextWorkspace = updater(current);
      saveWorkspace(nextWorkspace).catch(() => setLoadNote("Could not save to runtime/penny yet."));
      return nextWorkspace;
    });
  }

  function clearPennyArtifacts() {
    setLatestResponse(null);
    setLatestStyleReport(null);
    setReviewStatus(null);
    setAnnotationInstruction("");
    setRefineInstruction("");
  }

  function rememberResponseCandidate(response, context) {
    if (!response?.content || response.offline) return;
    const candidate = {
      ...response,
      id: response.id || `response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      context,
    };
    persistWith((current) => addResponseCandidate(current, context.documentId, candidate));
  }

  function beginPennyRequest(label) {
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setBusy(true);
    setRequestProgress({ label, startedAt: Date.now(), elapsedSeconds: 0 });
    return controller;
  }

  function finishPennyRequest(controller) {
    if (requestControllerRef.current === controller) {
      requestControllerRef.current = null;
      setRequestProgress(null);
      setBusy(false);
    }
  }

  function handleCancelRequest() {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setRequestProgress(null);
    setBusy(false);
    setReviewStatus({ kind: "info", message: "Penny request cancelled. The draft was not changed." });
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || /abort/i.test(error?.message || "");
  }

  function markRequestCancelledIfCurrent(controller, message) {
    if (requestControllerRef.current === controller) {
      setReviewStatus({ kind: "info", message });
    }
  }

  async function refreshRuntime() {
    try {
      setRuntime(await fetchRuntimeStatus());
    } catch (error) {
      setRuntime({ ok: false, stdout: "", stderr: error.message });
    }
  }

  async function handleRuntimeAction(action) {
    setBusy(true);
    try {
      const result = await runRuntimeAction(action);
      setRuntime(result);
      if (action.action !== "status") await refreshRuntime();
    } catch (error) {
      setRuntime({ ok: false, stdout: "", stderr: error.message });
    } finally {
      setBusy(false);
    }
  }

  function handleCreateDocument(title) {
    const trimmed = (title || "").trim();
    if (!trimmed) return;
    clearPennyArtifacts();
    persist(createDocument(workspace, { title: trimmed, writingType: "draft" }));
  }

  function handleSelectDocument(documentId) {
    clearPennyArtifacts();
    persist({ ...workspace, activeDocumentId: documentId, selectedText: "", selectionStart: null, selectionEnd: null });
  }

  function handleUpdateBody(body) {
    persist(clearSelectionFocus(updateDocumentText(workspace, activeDocument.id, body)));
  }

  function handleSelectMode(modeId) {
    persist(selectMode(workspace, modeId));
  }

  function handleStyleProfile(styleProfileId) {
    persist(selectDocumentStyleProfile(workspace, activeDocument.id, styleProfileId));
  }

  function handlePositioningContext(patch) {
    persist(updateDocumentPositioningContext(workspace, activeDocument.id, patch));
  }

  function handleInstruction(instruction) {
    persist({ ...workspace, instruction });
  }

  function handleSelectedText(selectedText) {
    const selection =
      typeof selectedText === "string"
        ? { text: selectedText, start: null, end: null }
        : {
            text: selectedText?.text || "",
            start: Number.isInteger(selectedText?.start) ? selectedText.start : null,
            end: Number.isInteger(selectedText?.end) ? selectedText.end : null,
          };
    if (busy) return;
    if (!selection.text) {
      persistWith(clearSelectionFocus);
      return;
    }
    persistWith((current) => setSelectionFocus(current, selection));
  }

  async function handleAskPenny() {
    workspaceDirtyRef.current = true;
    const controller = beginPennyRequest("Asking Penny");
    setReviewStatus({ kind: "pending", message: "Penny is reviewing the current scope..." });
    setAnnotationInstruction("");
    setRefineInstruction("");
    try {
      const result = await askPenny({
        modeId: workspace.selectedModeId,
        styleProfileId: activeDocument.styleProfileId,
        writingType: activeDocument.writingType,
        documentTitle: activeDocument.title,
        draft: activeDocument.body,
        selectedText: workspace.selectedText,
        instruction: workspace.instruction,
        positioningContext: activeDocument.positioningContext,
      }, {
        signal: controller.signal,
      });
      const context = buildPennyArtifactContext(workspace, activeDocument);
      const response = { ...result, id: `response-${Date.now()}`, context };
      setLatestResponse(response);
      const styleReport = result.responseStyleReport || result.sourceStyleReport || null;
      setLatestStyleReport(styleReport ? { ...styleReport, context } : null);
      setReviewStatus({ kind: "success", message: "Penny response ready." });
      rememberResponseCandidate(response, context);
    } catch (error) {
      if (isAbortError(error)) {
        markRequestCancelledIfCurrent(controller, "Penny request cancelled. The draft was not changed.");
        return;
      }
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not complete that request: ${error.message}`,
      });
    } finally {
      finishPennyRequest(controller);
    }
  }

  async function handleCheckVoice() {
    workspaceDirtyRef.current = true;
    const controller = beginPennyRequest("Checking voice");
    setLatestResponse(null);
    setAnnotationInstruction("");
    setRefineInstruction("");
    setReviewStatus({ kind: "pending", message: "Checking voice against the current draft..." });
    try {
      const result = await checkPennyStyle({
        modeId: workspace.selectedModeId,
        styleProfileId: activeDocument.styleProfileId,
        writingType: activeDocument.writingType,
        documentTitle: activeDocument.title,
        draft: activeDocument.body,
        selectedText: workspace.selectedText,
        positioningContext: activeDocument.positioningContext,
      }, {
        signal: controller.signal,
      });
      setLatestStyleReport({ ...result.report, context: buildPennyArtifactContext(workspace, activeDocument) });
      setReviewStatus({ kind: "success", message: `Voice check complete. Score ${result.report.voiceScore}.` });
    } catch (error) {
      if (isAbortError(error)) {
        markRequestCancelledIfCurrent(controller, "Voice check cancelled. The draft was not changed.");
        return;
      }
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not check the draft voice: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Voice check failed." });
    } finally {
      finishPennyRequest(controller);
    }
  }

  async function handleApplyVoiceRevision() {
    workspaceDirtyRef.current = true;
    const revisionScope = workspace.selectedText ? "selection" : "full_draft";
    const scopeLabel = revisionScope === "selection" ? "selected passage" : "full draft";
    const controller = beginPennyRequest("Drafting voice revision");
    setReviewStatus({ kind: "pending", message: `Preparing a replacement for the ${scopeLabel}...` });
    setAnnotationInstruction("");
    setRefineInstruction("");
    try {
      const result = await askPenny({
        modeId: workspace.selectedModeId,
        operation: "voice_revision",
        revisionScope,
        styleProfileId: activeDocument.styleProfileId,
        writingType: activeDocument.writingType,
        documentTitle: activeDocument.title,
        draft: activeDocument.body,
        selectedText: workspace.selectedText,
        positioningContext: activeDocument.positioningContext,
        instruction: [
          `Use the deterministic voice report to revise the ${scopeLabel} in place.`,
          "Return only replacement text.",
          workspace.instruction ? `Additional user instruction: ${workspace.instruction}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      }, {
        signal: controller.signal,
      });
      const context = buildPennyArtifactContext(workspace, activeDocument);
      const response = {
        ...result,
        id: `response-${Date.now()}`,
        context,
        applyMode: "replace",
        revisionScope,
        revisionLabel: revisionScope === "selection" ? "Replace selected passage" : "Replace full draft",
      };
      setLatestResponse(response);
      const styleReport = result.responseStyleReport || result.sourceStyleReport || null;
      setLatestStyleReport(styleReport ? { ...styleReport, context } : null);
      setReviewStatus({ kind: "success", message: "Replacement preview ready." });
      rememberResponseCandidate(response, context);
    } catch (error) {
      if (isAbortError(error)) {
        markRequestCancelledIfCurrent(controller, "Voice revision cancelled. The draft was not changed.");
        return;
      }
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not prepare a voice revision: ${error.message}`,
      });
    } finally {
      finishPennyRequest(controller);
    }
  }

  async function handleDraftInlineAnnotations(response, followUpInstruction) {
    if (!response?.content || response.offline) return;
    workspaceDirtyRef.current = true;
    const followUp = (followUpInstruction || "").trim();
    const controller = beginPennyRequest("Drafting inline notes");
    setReviewStatus({ kind: "pending", message: "Penny is drafting additive inline notes..." });
    try {
      const result = await askPenny({
        modeId: workspace.selectedModeId,
        operation: "inline_annotations",
        styleProfileId: activeDocument.styleProfileId,
        writingType: activeDocument.writingType,
        documentTitle: activeDocument.title,
        draft: activeDocument.body,
        selectedText: workspace.selectedText,
        positioningContext: activeDocument.positioningContext,
        instruction: [
          "Prior Penny response:",
          response.content,
          "",
          `User follow-up: ${followUp || "Apply the useful concepts as bracketed inline notes for manual revision."}`,
          "",
          "Create additive inline notes only. Do not rewrite or delete any draft text.",
        ].join("\n"),
      }, {
        signal: controller.signal,
      });
      const context = buildPennyArtifactContext(workspace, activeDocument);
      const hasInlineAnnotations = Array.isArray(result.inlineAnnotations) && result.inlineAnnotations.length > 0;
      const responseForState = hasInlineAnnotations ? { ...result, responseStyleReport: undefined } : result;
      const nextResponse = {
        ...responseForState,
        id: `response-${Date.now()}`,
        context,
        applyMode: hasInlineAnnotations ? "annotate" : result.applyMode,
        sourceResponse: response.sourceResponse || {
          content: response.content,
          modeId: response.modeId,
          styleProfileId: response.styleProfileId,
          responseStyleReport: response.responseStyleReport,
        },
      };
      setLatestResponse(nextResponse);
      const styleReport = hasInlineAnnotations ? result.sourceStyleReport || null : result.responseStyleReport || result.sourceStyleReport || null;
      setLatestStyleReport(styleReport ? { ...styleReport, context } : null);
      setReviewStatus({
        kind: hasInlineAnnotations ? "success" : "error",
        message: hasInlineAnnotations ? "Inline notes preview ready." : "Inline notes were not prepared.",
      });
      rememberResponseCandidate(nextResponse, context);
    } catch (error) {
      if (isAbortError(error)) {
        markRequestCancelledIfCurrent(controller, "Inline note request cancelled. The draft was not changed.");
        return;
      }
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not prepare inline notes: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Inline notes were not prepared." });
    } finally {
      finishPennyRequest(controller);
    }
  }

  function handleInsertSuggestion(response) {
    try {
      const undoSnapshot = createPennyUndoSnapshot(workspace, activeDocument.id, "Insert Penny suggestion");
      persist(
        applySuggestionToDocument(workspace, {
          documentId: activeDocument.id,
          suggestion: response.content,
          artifactContext: response.context,
        }),
      );
      setPennyUndo(undoSnapshot);
      setLatestResponse(null);
      setReviewStatus({ kind: "success", message: "Penny suggestion inserted. Undo is available." });
    } catch (error) {
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not insert that suggestion: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Penny suggestion was not inserted." });
    }
  }

  function handleApplyInlineAnnotations(response) {
    try {
      const undoSnapshot = createPennyUndoSnapshot(workspace, activeDocument.id, "Insert Penny inline notes");
      persist(
        insertInlineAnnotations(workspace, {
          documentId: activeDocument.id,
          annotations: response.inlineAnnotations,
          artifactContext: response.context,
        }),
      );
      setPennyUndo(undoSnapshot);
      setLatestResponse(null);
      setLatestStyleReport(null);
      setAnnotationInstruction("");
      setReviewStatus({ kind: "success", message: "Inline notes inserted into the draft. Undo is available." });
    } catch (error) {
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not insert those inline notes: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Inline notes were not inserted." });
    }
  }

  function handleApplyReplacement(response) {
    try {
      const undoSnapshot = createPennyUndoSnapshot(workspace, activeDocument.id, "Apply Penny replacement");
      persist(
        replaceDocumentTextWithSuggestion(workspace, {
          documentId: activeDocument.id,
          suggestion: response.content,
          artifactContext: response.context,
        }),
      );
      setPennyUndo(undoSnapshot);
      setLatestResponse(null);
      setLatestStyleReport(null);
      setReviewStatus({ kind: "success", message: "Voice revision applied in place. Undo is available." });
    } catch (error) {
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not apply that revision: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Voice revision was not applied." });
    }
  }

  function handleUndoPennyChange() {
    if (!pennyUndo) return;
    try {
      persist(restorePennyUndoSnapshot(workspace, pennyUndo));
      setPennyUndo(null);
      setReviewStatus({ kind: "success", message: "Last Penny change undone." });
    } catch (error) {
      setReviewStatus({ kind: "error", message: error.message });
    }
  }

  function handleFocusAnchor(anchor) {
    const draft = activeDocument.body || "";
    let start = null;
    let end = null;
    if (typeof anchor === "string") {
      const anchorText = anchor.trim();
      const firstMatch = draft.indexOf(anchorText);
      if (firstMatch === -1) {
        setReviewStatus({ kind: "error", message: "Penny could not find that anchor in the current draft." });
        return;
      }
      const secondMatch = draft.indexOf(anchorText, firstMatch + anchorText.length);
      if (secondMatch !== -1) {
        setReviewStatus({ kind: "error", message: "That anchor appears more than once. Ask Penny for a more specific anchor." });
        return;
      }
      start = firstMatch;
      end = firstMatch + anchorText.length;
    } else if (Number.isInteger(anchor?.start) && Number.isInteger(anchor?.end) && anchor.end > anchor.start) {
      start = anchor.start;
      end = anchor.end;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || draft.slice(start, end).length === 0) {
      setReviewStatus({ kind: "error", message: "Penny could not focus that draft location." });
      return;
    }
    setAnchorFocus({ start, end, kind: "anchor", id: Date.now() });
    setReviewStatus({ kind: "info", message: "Penny highlighted the target text in the draft." });
  }

  function handleSelectionAction(action) {
    if (action === "ask") {
      persist({ ...workspace, instruction: "Talk through this selected passage. Name what is working, what is weak, and what you would change." });
      return;
    }
    if (action === "revise") {
      handleApplyVoiceRevision();
      return;
    }
    if (action === "note") {
      persist({ ...workspace, instruction: "Add bracketed Penny notes around this selected passage so I can revise it manually." });
      setAnnotationInstruction("Add bracketed Penny notes around this selected passage so I can revise it manually.");
      return;
    }
  }

  async function handleRefineResponse(response, followUpInstruction) {
    const followUp = (followUpInstruction || "").trim();
    if (!response?.content || response.offline || !followUp) return;
    const isReplacement = response.applyMode === "replace";
    const revisionScope = response.revisionScope || (workspace.selectedText ? "selection" : "full_draft");
    const controller = beginPennyRequest("Refining response");
    setReviewStatus({ kind: "pending", message: "Penny is refining the prior response..." });
    try {
      const result = await askPenny({
        modeId: workspace.selectedModeId,
        operation: isReplacement ? "voice_revision" : "refine_response",
        documentId: activeDocument.id,
        revisionScope: isReplacement ? revisionScope : undefined,
        styleProfileId: activeDocument.styleProfileId,
        writingType: activeDocument.writingType,
        documentTitle: activeDocument.title,
        draft: activeDocument.body,
        selectedText: workspace.selectedText,
        positioningContext: activeDocument.positioningContext,
        instruction: [
          "Prior Penny response:",
          response.content,
          "",
          `User follow-up: ${followUp}`,
          "",
          isReplacement
            ? "Return only replacement text for the same target scope."
            : "Return a revised response that incorporates the follow-up without losing the useful prior context.",
        ].join("\n"),
      }, {
        signal: controller.signal,
      });
      const context = buildPennyArtifactContext(workspace, activeDocument);
      const nextResponse = {
        ...result,
        id: `response-${Date.now()}`,
        context,
        applyMode: isReplacement ? "replace" : result.applyMode,
        revisionScope: isReplacement ? revisionScope : result.revisionScope,
        sourceResponse: response,
      };
      setLatestResponse(nextResponse);
      const styleReport = result.responseStyleReport || result.sourceStyleReport || null;
      setLatestStyleReport(styleReport ? { ...styleReport, context } : null);
      setRefineInstruction("");
      setReviewStatus({ kind: "success", message: "Refined response ready." });
      rememberResponseCandidate(nextResponse, context);
    } catch (error) {
      if (isAbortError(error)) {
        markRequestCancelledIfCurrent(controller, "Refine request cancelled. The draft was not changed.");
        return;
      }
      setLatestResponse({
        offline: true,
        context: artifactContext,
        content: `Penny could not refine that response: ${error.message}`,
      });
      setReviewStatus({ kind: "error", message: "Penny response was not refined." });
    } finally {
      finishPennyRequest(controller);
    }
  }

  function handleDiscardResponse() {
    setLatestResponse(null);
    setAnnotationInstruction("");
    setRefineInstruction("");
    setReviewStatus({ kind: "info", message: "Penny suggestion discarded." });
  }

  function handleClearSelectionFocus() {
    persistWith(clearSelectionFocus);
  }

  function handleRestoreCandidate(candidateId) {
    const candidate = selectResponseCandidate(workspace, activeDocument.id, candidateId);
    if (!candidate) return;
    setLatestResponse(candidate);
    setLatestStyleReport(candidate.responseStyleReport || candidate.sourceStyleReport || null);
    setReviewStatus({ kind: "info", message: "Saved Penny response restored to review." });
  }

  function handlePinCandidate(candidateId, pinned) {
    persist(pinResponseCandidate(workspace, activeDocument.id, candidateId, pinned));
  }

  function handleDeleteCandidate(candidateId) {
    persist(deleteResponseCandidate(workspace, activeDocument.id, candidateId));
    if (latestResponse?.id === candidateId) {
      setLatestResponse(null);
      setLatestStyleReport(null);
    }
  }

  return (
    <div className="app-shell">
      <RuntimeToolbar runtime={runtime} onAction={handleRuntimeAction} busy={busy} />
      <div className="workspace-grid">
        <ProjectRail workspace={workspace} activeDocument={activeDocument} onCreateDocument={handleCreateDocument} onSelectDocument={handleSelectDocument} />
        <EditorCanvas
          document={activeDocument}
          onUpdateBody={handleUpdateBody}
          selectedText={workspace.selectedText}
          selectionStart={workspace.selectionStart}
          selectionEnd={workspace.selectionEnd}
          onSelectedText={handleSelectedText}
          onSelectionAction={handleSelectionAction}
          anchorFocus={anchorFocus}
        />
        <PennyPanel
          workspace={workspace}
          document={activeDocument}
          selectedText={workspace.selectedText}
          selectionStart={workspace.selectionStart}
          selectionEnd={workspace.selectionEnd}
          onMode={handleSelectMode}
          onStyleProfile={handleStyleProfile}
          onPositioningContext={handlePositioningContext}
          onInstruction={handleInstruction}
          onClearSelection={handleClearSelectionFocus}
          onSelectionAction={handleSelectionAction}
          onAsk={handleAskPenny}
          onCheckVoice={handleCheckVoice}
          onApplyVoiceRevision={handleApplyVoiceRevision}
          onApplyReplacement={handleApplyReplacement}
          onDraftInlineAnnotations={handleDraftInlineAnnotations}
          onApplyInlineAnnotations={handleApplyInlineAnnotations}
          onDiscardResponse={handleDiscardResponse}
          onInsert={handleInsertSuggestion}
          onUndo={handleUndoPennyChange}
          undoSnapshot={pennyUndo}
          onCancelRequest={handleCancelRequest}
          requestProgress={requestProgress}
          onFocusAnchor={handleFocusAnchor}
          onFocusFinding={handleFocusAnchor}
          onRefineResponse={handleRefineResponse}
          onRestoreCandidate={handleRestoreCandidate}
          onPinCandidate={handlePinCandidate}
          onDeleteCandidate={handleDeleteCandidate}
          annotationInstruction={annotationInstruction}
          onAnnotationInstruction={setAnnotationInstruction}
          refineInstruction={refineInstruction}
          onRefineInstruction={setRefineInstruction}
          busy={busy}
          latestResponse={latestResponse}
          latestStyleReport={latestStyleReport}
          responseFreshness={responseFreshness}
          styleFreshness={styleFreshness}
          reviewStatus={reviewStatus}
          latestResponseRef={latestResponseRef}
        />
      </div>
      <footer className="privacy-footer">
        <span>{loadNote}</span>
        <span>No cloud service configured. Model calls go to 127.0.0.1:8091 only.</span>
      </footer>
    </div>
  );
}
