'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface StageView {
  stage: string;
  arm: string;
  seconds: { min: number; max: number };
  elapsedSeconds?: number;
  passage?: {
    id: string;
    title: string;
    text: string;
    annotations: { term: string; gloss: string }[];
    /** empty for the control arm by design — see src/lib/config.ts lowerBoundArms */
    targets: { id: string; text: string; done: boolean }[];
    showAnnotations: boolean;
  };
  items?: { id: string; stem: string; options: string[]; level: string }[];
  lowerBound?: { applies: boolean; required: number; done: number; met: boolean };
  /** seconds the reader must stay on S2 before continuing; 0 = no time gate */
  minSeconds?: number;
  proctor?: { fullscreen: boolean; warnBeforeLeaving: boolean };
  assist?: {
    locked: boolean;
    pendingSelection: string | null;
    pendingRange: { start: number; end: number } | null;
    sidebar: boolean;
  };
  /** present only when the reader reloaded mid-interaction; rebuilds the reply widget */
  pendingTurn?: {
    interactionId: string;
    turnIndex: number;
    kind: AssistTurn['kind'];
    text: string;
    choice?: { prompt: string; options: string[] };
    focus?: { options: string[]; allowOther: true };
  };
  config: { version: string };
}

interface AssistTurn {
  interactionId: string;
  turnIndex?: number | null;
  kind: 'focus' | 'question' | 'choice' | 'reject' | 'explanation' | 'none';
  text: string;
  choice?: { prompt: string; options: string[] };
  focus?: { options: string[]; allowOther: true };
  completed: boolean;
  lowerBoundMet: boolean;
  /** authoritative list of finished target sentences; never counted on the client */
  completedTargetIds: string[];
  degraded?: boolean;
  range?: { start: number; end: number };
}

function useToken() {
  const [token, setToken] = useState('');
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const u = new URL(window.location.href);
    setToken(u.searchParams.get('t') ?? '');
    setDelayed(u.searchParams.get('d') === '1');
  }, []);
  return { token, delayed };
}

/**
 * PROCTORING — deterrence and measurement, never enforcement.
 *
 * A web page cannot stop anyone leaving: Alt-Tab, a second monitor, a phone next to the
 * laptop and closing the lid are all outside its reach, and leaving fullscreen with Esc
 * cannot be blocked by any browser API. What this does is make leaving deliberate and
 * leave a trace:
 *   - asks for fullscreen at the start of each test stage (needs a click: browsers only
 *     grant fullscreen from a user gesture)
 *   - notices and logs every exit from fullscreen, and asks the reader to come back
 *   - logs every window blur, which catches window switches that visibilitychange misses
 *   - lets the browser show its own "leave site?" dialog on navigation away
 *
 * The consent page promises the reader may close the page and withdraw at any time.
 * Nothing here breaks that: the dialog is one click to confirm, and nothing is blocked.
 */
function useProctor(
  token: string,
  delayed: boolean,
  stage: string | undefined,
  settings: { fullscreen: boolean; warnBeforeLeaving: boolean }
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const log = useCallback(
    (event: string) => {
      if (!token) return;
      void fetch('/api/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, delayed, event, payload: { stage } }),
      });
    },
    [token, delayed, stage]
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    const onChange = () => {
      const on = Boolean(document.fullscreenElement);
      setIsFullscreen(on);
      if (settings.fullscreen) log(on ? 'fullscreen_enter' : 'fullscreen_exit');
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [settings.fullscreen, log]);

  useEffect(() => {
    if (!settings.fullscreen) return;
    const onBlur = () => log('window_blur');
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [settings.fullscreen, log]);

  useEffect(() => {
    if (!settings.warnBeforeLeaving) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // the browser shows its own wording; it cannot be customised
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [settings.warnBeforeLeaving]);

  const request = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // denied or unsupported: carry on, the attempt is all we can do
    }
  }, []);

  return { isFullscreen, request };
}

/** Shown over the stage while a test stage is not in fullscreen. */
function FullscreenGate({ onEnter, resuming }: { onEnter: () => void; resuming: boolean }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(250,249,247,.97)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>{resuming ? '請回到全螢幕' : '準備開始'}</h2>
        <p style={{ fontSize: 15, lineHeight: 1.9 }}>
          {resuming
            ? '作答期間離開全螢幕會被記錄下來。請按下面的按鈕回到全螢幕，再繼續作答。'
            : '這一段請在全螢幕下作答，中途切換視窗會被記錄。按下面的按鈕開始。'}
        </p>
        <button onClick={onEnter} style={{ fontSize: 16, padding: '8px 20px' }}>
          {resuming ? '回到全螢幕' : '進入全螢幕並開始'}
        </button>
        <p style={{ fontSize: 13, color: '#666', marginTop: 20 }}>
          你隨時可以關閉頁面退出，不會有任何影響。
        </p>
      </div>
    </div>
  );
}

function Runner() {
  const { token, delayed } = useToken();
  const [view, setView] = useState<StageView | null>(null);
  const [error, setError] = useState('');
  const startedAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/state?t=${token}${delayed ? '&d=1' : ''}`);
    if (!res.ok) {
      const e = (await res.json()) as { error?: string };
      setError(e.error ?? '錯誤');
      return;
    }
    setView((await res.json()) as StageView);
    startedAt.current = Date.now();
  }, [token, delayed]);

  useEffect(() => {
    void load();
  }, [load]);

  // tab-switch logging (design doc: >3 switches flags the record)
  useEffect(() => {
    if (!token) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        void fetch('/api/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, delayed, event: 'visibility_change' }),
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [token, delayed]);

  // copy / paste / context menu disabled during the study
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    ['copy', 'paste', 'contextmenu', 'cut'].forEach((ev) => document.addEventListener(ev, block));
    return () =>
      ['copy', 'paste', 'contextmenu', 'cut'].forEach((ev) => document.removeEventListener(ev, block));
  }, []);

  // `startedAt` used to be set once when the page mounted, so elapsedSeconds for S5
  // silently included every earlier stage and the below_min_time_* flags were wrong.
  // Reset it whenever the stage actually changes.
  useEffect(() => {
    startedAt.current = Date.now();
  }, [view?.stage]);

  // Proctoring settings arrive with the stage, so only real test stages are gated.
  const proctor = view?.proctor ?? { fullscreen: false, warnBeforeLeaving: false };
  const { isFullscreen, request: requestFullscreen } = useProctor(
    token,
    delayed,
    view?.stage,
    proctor
  );
  const everEntered = useRef(false);
  useEffect(() => {
    if (isFullscreen) everEntered.current = true;
  }, [isFullscreen]);

  const advance = useCallback(
    async (reason: 'user' | 'timeout') => {
      const elapsedSeconds = Math.round((Date.now() - startedAt.current) / 1000);
      const res = await fetch('/api/advance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, delayed, reason, elapsedSeconds }),
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        setError(e.error ?? '');
        return;
      }
      setError('');
      await load();
    },
    [token, delayed, load]
  );

  if (error) return <Shell>{<p style={{ color: '#a33' }}>{error}</p>}</Shell>;
  if (!view) return <Shell>{<p>載入中…</p>}</Shell>;

  const gate = proctor.fullscreen && !isFullscreen ? (
    <FullscreenGate onEnter={() => void requestFullscreen()} resuming={everEntered.current} />
  ) : null;

  // S2 with a sidebar needs 680 + 24 + 360; every other screen stays at the narrow
  // reading width so line length does not change from stage to stage.
  const wide = view.stage === 'S2' && (view.assist?.sidebar ?? false);

  const body = (() => {
    if (view.stage === 'WAIT_DELAYED') {
      const v = view as unknown as { delayedPath: string; earliest: string; latest?: string };
      return (
        <Shell>
          <Done delayedPath={v.delayedPath} earliest={v.earliest} latest={v.latest} />
        </Shell>
      );
    }
    if (view.stage === 'DONE')
      return (
        <Shell>
          <Done />
        </Shell>
      );
    if (view.stage === 'S2')
      return (
        <Shell wide={wide}>
          <Reading view={view} token={token} onAdvance={advance} />
        </Shell>
      );
    if (view.stage === 'S4')
      return (
        <Shell>
          <Scales token={token} onDone={load} />
        </Shell>
      );
    if (view.items) {
      return (
        <Shell>
          <Quiz
            key={view.stage}
            view={view}
            token={token}
            delayed={delayed}
            onDone={load}
          />
        </Shell>
      );
    }
    return <Shell>{<p>（此階段沒有內容，請聯絡研究者）</p>}</Shell>;
  })();

  // The gate sits on top of the stage rather than replacing it: the timer keeps running
  // and nothing is lost if the reader steps out and comes back.
  return (
    <>
      {body}
      {gate}
    </>
  );
}

/** Page width. Only S2-with-sidebar is wide; everything else keeps the reading width. */
function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div style={{ maxWidth: wide ? 1064 : 860, margin: '0 auto' }}>{children}</div>;
}

function Timer({ seconds, onTimeout }: { seconds: number; onTimeout: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(id);
          onTimeout();
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // onTimeout intentionally not a dependency: it changes identity every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return (
    <div style={{ position: 'sticky', top: 0, background: '#faf9f7', padding: '8px 0', textAlign: 'right' }}>
      剩餘 {m}:{s}
    </div>
  );
}

function PassageText({
  view,
  token,
  onSelect,
  locked = false,
  activeRange,
  showUnlock,
  onUnlock,
}: {
  view: StageView;
  token: string;
  /** the selection text AND its character offset inside the passage string */
  onSelect?: (s: string, start: number | undefined) => void;
  /** while locked the passage takes no new selection */
  locked?: boolean;
  /** which character range of `passage.text` is the current open highlight */
  activeRange?: { start: number; end: number } | null;
  /** render the "解鎖，換下一句" button inline after the highlighted span */
  showUnlock?: boolean;
  onUnlock?: () => void;
}) {
  const passage = view.passage!;
  const annotated = useMemo(() => passage.annotations.map((a) => a.term), [passage.annotations]);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);

  const active = Boolean(onSelect) && !locked;

  /**
   * The passage is one text node when idle so `window.getSelection()` gives offsets
   * directly. Once an interaction is open, we split it into up to three runs so we
   * can (a) mark the highlighted span visually and (b) put the inline unlock button
   * right after it. New selections are then blocked by `locked`.
   */
  const rangeIsValid =
    activeRange != null &&
    activeRange.start >= 0 &&
    activeRange.end > activeRange.start &&
    activeRange.end <= passage.text.length;

  const onMouseUp = () => {
    if (!active) return;
    const win = window.getSelection();
    const raw = win?.toString() ?? '';
    const sel = raw.trim();
    if (sel.length === 0) return;
    let start: number | undefined;
    if (win && win.rangeCount > 0 && bodyRef.current) {
      const range = win.getRangeAt(0);
      // The passage node may or may not be split into spans depending on whether
      // an interaction is open. Only trust the offset when the range's start
      // container is the single text child of the body — otherwise fall back to
      // substring resolution on the server.
      const node = bodyRef.current.firstChild;
      if (node && range.startContainer === node && node.nodeType === Node.TEXT_NODE) {
        const leading = raw.length - raw.trimStart().length;
        start = range.startOffset + leading;
        if (passage.text.slice(start, start + sel.length) !== sel) start = undefined;
      }
    }
    onSelect!(raw, start);
  };

  const body = rangeIsValid ? (
    <>
      {passage.text.slice(0, activeRange!.start)}
      <span
        style={{
          background: '#fdf1cd',
          boxShadow: 'inset 0 -2px 0 #d6a100',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {passage.text.slice(activeRange!.start, activeRange!.end)}
      </span>
      {showUnlock && (
        <button
          type="button"
          className="inline-unlock"
          onClick={(e) => {
            e.stopPropagation();
            onUnlock?.();
          }}
          title="這一句已經看完了，按一下就可以問下一句"
        >
          解鎖，換下一句 →
        </button>
      )}
      {passage.text.slice(activeRange!.end)}
    </>
  ) : (
    passage.text
  );

  return (
    <div style={{ lineHeight: 2.2, fontSize: 18, letterSpacing: 1 }}>
      <h3>{passage.title}</h3>
      <p
        ref={bodyRef}
        className={`passage-body${locked ? ' locked' : ''}`}
        onMouseUp={onMouseUp}
        style={{ opacity: locked ? 0.9 : 1, transition: 'opacity .15s' }}
      >
        {body}
      </p>
      {passage.showAnnotations && (
        <div style={{ fontSize: 14, borderTop: '1px solid #ddd', paddingTop: 8 }}>
          <b>註解</b>
          <ul>
            {passage.annotations.map((a) => (
              <li
                key={a.term}
                onClick={() =>
                  void fetch('/api/event', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      token,
                      event: 'annotation_click',
                      payload: { term: a.term },
                    }),
                  })
                }
                style={{ cursor: 'pointer' }}
              >
                <span style={{ borderBottom: '1px dashed #666' }}>{a.term}</span>：{a.gloss}
              </li>
            ))}
          </ul>
          {annotated.length === 0 && <p>（本篇無註解）</p>}
        </div>
      )}
    </div>
  );
}

interface ChatMessage {
  interactionId: string;
  highlightText: string;
  actor: 'system' | 'user';
  type: string;
  text: string;
  ts: string;
}

/**
 * The whole S2 conversation, as one continuous thread. Reads like a chat panel:
 * user turns align right with a 「你」 label, AI turns align left with an 「AI」
 * label, and the composer is pinned to the bottom of a full-height column.
 *
 * The composer LOOKS like a chat input; what it accepts is still the current
 * ladder rung — free-text answer, a set of options, or 看完了 — decided by the
 * server. This is CLAUDE.md invariant 1 (the model never decides when the
 * explanation appears), so the panel must never turn into free-form chat.
 *
 * The transcript comes from /api/transcript, so a reload does not wipe the
 * session out from under the reader.
 */
function ChatPanel({
  messages,
  turn,
  pending,
  degraded,
  children,
}: {
  messages: ChatMessage[];
  turn: AssistTurn | null;
  /** true while a reply is in flight; renders an AI-side thinking bubble */
  pending: boolean;
  degraded?: boolean;
  children?: ReactNode;
}) {
  const bottom = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, turn?.text, pending]);

  let lastInteraction = '';
  return (
    <aside className="s2-aside">
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e3e3e3',
          fontSize: 13,
          color: '#555',
          background: '#fbfaf8',
          flex: '0 0 auto',
        }}
      >
        對話紀錄（這一階段的全部內容都留在這裡）
      </div>
      <div className="chat-scroll">
        {messages.length === 0 && !pending && (
          <p style={{ fontSize: 13, color: '#777', margin: 0 }}>
            還沒有對話。在左邊選一段文字就會開始。
          </p>
        )}
        {messages.map((m, i) => {
          const isNew = m.interactionId !== lastInteraction;
          lastInteraction = m.interactionId;
          const isUser = m.actor === 'user';
          return (
            <div key={i}>
              {isNew && <div className="chat-mark">標記了：「{m.highlightText}」</div>}
              <div className={`chat-row ${isUser ? 'user' : 'system'}`}>
                <span className="chat-role">{isUser ? '你' : 'AI'}</span>
                <p className={`chat-msg ${isUser ? 'user' : 'system'}`}>{m.text}</p>
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="chat-row system">
            <span className="chat-role">AI</span>
            <p className="chat-msg system pending">AI 正在想…</p>
          </div>
        )}
        {degraded && !pending && (
          <p style={{ fontSize: 12, color: '#a33' }}>（系統暫時降級）</p>
        )}
        <div ref={bottom} />
      </div>
      <div className="chat-footer">{children}</div>
    </aside>
  );
}

/** null = free to highlight; 'open' = conversation running; 'finished' = waiting to unlock */
type LockState = null | 'open' | 'finished';

function Reading({
  view,
  token,
  onAdvance,
}: {
  view: StageView;
  token: string;
  onAdvance: (r: 'user' | 'timeout') => void;
}) {
  // Seeded from the server so a refresh mid-conversation restores the reply widget
  // instead of leaving the reader with a locked passage and nothing to click.
  const [turn, setTurn] = useState<AssistTurn | null>(() =>
    view.pendingTurn
      ? {
          interactionId: view.pendingTurn.interactionId,
          turnIndex: view.pendingTurn.turnIndex,
          kind: view.pendingTurn.kind,
          text: view.pendingTurn.text,
          choice: view.pendingTurn.choice,
          focus: view.pendingTurn.focus,
          completed: false,
          lowerBoundMet: view.lowerBound?.met ?? false,
          completedTargetIds: [],
        }
      : null
  );
  const [input, setInput] = useState('');
  const [choiceIndex, setChoiceIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [focusOther, setFocusOther] = useState('');
  const [reason, setReason] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState('');
  const [posting, setPosting] = useState(false);

  // Whether this arm has the four-sentence gate at all. Control does not.
  const gated = view.lowerBound?.applies ?? true;
  const required = view.lowerBound?.required ?? 0;
  const minSeconds = view.minSeconds ?? 0;
  const hasSidebar = view.assist?.sidebar ?? true;

  // Server-authoritative. The client does not keep its own tally.
  const [doneIds, setDoneIds] = useState<string[]>(
    () => view.passage?.targets.filter((t) => t.done).map((t) => t.id) ?? []
  );
  const [met, setMet] = useState(view.lowerBound?.met ?? false);

  // THE LOCK. Seeded from the server so a reload does not unlock a live interaction.
  const [lock, setLock] = useState<LockState>(view.assist?.locked ? 'open' : null);
  // Where the current highlight sits in the passage. Server-authoritative — a
  // reload restores it from `view.assist.pendingRange`, and every /api/assist
  // response carries the latest range.
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(
    view.assist?.pendingRange ?? null
  );

  // Only used by the ungated (control) arm, to unlock the continue button.
  const [elapsed, setElapsed] = useState(view.elapsedSeconds ?? 0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const timeLeft = Math.max(0, minSeconds - elapsed);
  const canContinue = gated ? met : timeLeft === 0;

  const loadTranscript = useCallback(async () => {
    if (!hasSidebar || !token) return;
    const res = await fetch(`/api/transcript?t=${token}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages?: ChatMessage[] };
    setMessages(data.messages ?? []);
  }, [hasSidebar, token]);

  useEffect(() => {
    void loadTranscript();
  }, [loadTranscript]);

  const post = async (payload: Record<string, unknown>) => {
    setPosting(true);
    try {
      const res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, interactionId: turn?.interactionId, turnIndex: turn?.turnIndex, ...payload }),
      });
      const data = (await res.json()) as AssistTurn & { error?: string };
      if (!res.ok || data.error) {
        setNotice(
          data.error === 'interaction in progress'
            ? '目前這一句還沒結束，請先看完再換下一句。'
            : '沒有送出成功，請再試一次。'
        );
        return;
      }
      setNotice('');
      setTurn(data);
      setMet(data.lowerBoundMet);
      if (data.completedTargetIds) setDoneIds(data.completedTargetIds);
      if (data.range) setActiveRange(data.range);
      // A finished interaction stays locked. Switching sentences is a deliberate act:
      // the reader presses 解鎖 for it, next to the highlight.
      setLock(data.completed ? 'finished' : 'open');
      if (data.completed) setTurn(null);
      setInput('');
      setChoiceIndex(null);
      setFocusIndex(null);
      setFocusOther('');
      setReason('');
      await loadTranscript();
    } finally {
      setPosting(false);
    }
  };

  /**
   * The reply widget for the turn in play, pinned to the bottom of the sidebar.
   *
   * The panel LOOKS like a chat input, but what it accepts is governed by the
   * server's state machine (invariant 1). When there is no open interaction the
   * composer stays visible in a disabled state instead of vanishing — that is
   * what makes the panel read like a chat rather than a form that appears and
   * disappears mid-session.
   */
  const composer = (() => {
    if (turn && turn.kind !== 'none') {
      if (turn.kind === 'focus' && turn.focus) {
        const value = focusIndex === -1
          ? focusOther.trim()
          : focusIndex === null
            ? ''
            : turn.focus.options[focusIndex] ?? '';
        return (
          <>
            {turn.focus.options.map((option, index) => (
              <p key={option} style={{ margin: '4px 0', fontSize: 14 }}>
                <label>
                  <input
                    type="radio"
                    name="focus"
                    checked={focusIndex === index}
                    onChange={() => setFocusIndex(index)}
                    disabled={posting}
                  />
                  {option}
                </label>
              </p>
            ))}
            <p style={{ margin: '8px 0 4px', fontSize: 14 }}>
              <label>
                <input
                  type="radio"
                  name="focus"
                  checked={focusIndex === -1}
                  onChange={() => setFocusIndex(-1)}
                  disabled={posting}
                />
                其他
              </label>
            </p>
            {focusIndex === -1 && (
              <input
                type="text"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
                value={focusOther}
                onChange={(event) => setFocusOther(event.target.value)}
                placeholder="輸入反白範圍內的字或詞"
                disabled={posting}
              />
            )}
            <button
              disabled={posting || value.length === 0}
              onClick={() => void post({
                action: 'focus',
                value,
                source: focusIndex === -1 ? 'other' : 'suggestion',
              })}
            >
              確認
            </button>
          </>
        );
      }
      if (turn.kind === 'question') {
        return (
          <>
            <textarea
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="寫下你的想法，答錯沒關係"
              disabled={posting}
            />
            <button
              disabled={posting || input.trim().length === 0}
              onClick={() => void post({ action: 'answer', text: input })}
            >
              送出
            </button>{' '}
            <button
              style={{
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 13,
              }}
              disabled={posting}
              onClick={() => void post({ action: 'answer', text: '我不確定' })}
            >
              我不確定
            </button>
          </>
        );
      }
      if ((turn.kind === 'choice' || turn.kind === 'reject') && turn.choice) {
        return (
          <>
            {turn.choice.options.map((o, i) => (
              <p key={i} style={{ margin: '4px 0', fontSize: 14 }}>
                <label>
                  <input
                    type="radio"
                    name="choice"
                    checked={choiceIndex === i}
                    onChange={() => setChoiceIndex(i)}
                    disabled={posting}
                  />
                  {o}
                </label>
              </p>
            ))}
            <p style={{ fontSize: 13, margin: '8px 0 4px' }}>為什麼這樣選？（答錯沒關係）</p>
            <textarea
              rows={2}
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={posting}
            />
            <button
              disabled={posting || choiceIndex === null}
              onClick={() => void post({ action: 'choice', index: choiceIndex, reason })}
            >
              送出
            </button>
          </>
        );
      }
      if (turn.kind === 'explanation') {
        return (
          <button disabled={posting} onClick={() => void post({ action: 'read_done' })}>
            看完了
          </button>
        );
      }
    }
    if (lock === 'finished') {
      // The primary unlock button lives INLINE next to the highlight (see
      // PassageText). The panel just points at it so the reader is not stuck
      // looking for a button that used to be here.
      return (
        <p className="chat-composer-idle" style={{ margin: 0 }}>
          這一句看完了。按正文那句話後面的<b>「解鎖」</b>就可以問下一句。
        </p>
      );
    }
    // Idle: no open interaction. Show a disabled composer so the panel keeps its
    // shape instead of collapsing to a header. The reader responds by SELECTING
    // in the passage; there is no free-form message box, by design.
    return (
      <>
        <textarea
          rows={2}
          style={{ width: '100%', boxSizing: 'border-box' }}
          placeholder="在左邊選一段文字開始"
          disabled
          value=""
          readOnly
        />
        <p className="chat-composer-idle" style={{ margin: '4px 0 0' }}>
          在左邊選一段文字，就會開始一段對話。
        </p>
      </>
    );
  })();

  return (
    <div className="s2-grid">
      <div className="s2-main">
        <Timer seconds={view.seconds.max} onTimeout={() => onAdvance('timeout')} />
        {/* Nothing is shaded and nothing is required: where the reader looks and how much
            they ask is the thing being observed, so the copy must not point anywhere. */}
        {hasSidebar ? (
          <p style={{ fontSize: 14 }}>
            用滑鼠選取你看不懂的地方就可以問。<b>想問幾處都可以，不問也可以。</b>
            <br />
            一次只能問一處，問完按<b>解鎖</b>才能問下一處。
          </p>
        ) : (
          <p style={{ fontSize: 14 }}>
            用滑鼠選取你看不懂的地方，系統會記錄下來。
            <b>想標幾處都可以，不標也可以。</b>
            標記後按<b>解鎖</b>才能標下一處。
          </p>
        )}

        <PassageText
          view={view}
          token={token}
          locked={lock !== null}
          activeRange={lock !== null ? activeRange : null}
          showUnlock={lock === 'finished'}
          onUnlock={() => {
            setLock(null);
            setActiveRange(null);
            setNotice('');
          }}
          onSelect={(selection, start) =>
            void post({ action: 'highlight', selection, start })
          }
        />

        {notice && <p style={{ fontSize: 14, color: '#a33' }}>{notice}</p>}

        {/* Control has no sidebar. The unlock button lives inline next to the
            highlight (see PassageText), same as the AI arms — one behaviour for
            the whole study. */}
        {!hasSidebar && (
          <p style={{ fontSize: 14, color: '#555' }}>（本組沒有 AI 回應，你的標記已記錄。）</p>
        )}

        <p style={{ marginTop: 24 }}>
          <button disabled={!canContinue} onClick={() => onAdvance('user')}>
            {canContinue
              ? '進入下一階段'
              : gated
                ? `還有 ${required - doneIds.length} 句沒問過`
                : `還需停留 ${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}
          </button>
        </p>
        {!canContinue && !gated && (
          <p style={{ fontSize: 13, color: '#666', marginTop: -12 }}>
            時間到之前可以繼續讀，也可以繼續問，或什麼都不做。
          </p>
        )}
      </div>

      {hasSidebar && (
        <ChatPanel
          messages={messages}
          turn={turn}
          pending={posting}
          degraded={turn?.degraded}
        >
          {composer}
        </ChatPanel>
      )}
    </div>
  );
}

function Quiz({
  view,
  token,
  delayed,
  onDone,
}: {
  view: StageView;
  token: string;
  delayed: boolean;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const startTs = useRef(Date.now());
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState('');

  const submit = async (reason: 'user' | 'timeout' = 'user') => {
    if (submitting.current) return;
    submitting.current = true;
    const payload = (view.items ?? []).map((i) => ({
      itemId: i.id,
      chosen: answersRef.current[i.id] ?? null,
      rtMs: Math.round((Date.now() - startTs.current) / (view.items?.length ?? 1)),
    }));
    try {
    const response = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, delayed, stage: view.stage, answers: payload, reason }),
    });
    if (!response.ok) { setSubmitError('交卷失敗，答案仍保留，請再按交卷。'); return; }
    onDone();
    } catch { setSubmitError('連線失敗，答案仍保留，請再按交卷。'); }
    finally { submitting.current = false; }
  };

  return (
    <div>
      <Timer seconds={view.seconds.max} onTimeout={() => void submit('timeout')} />
      {view.passage && view.passage.text && <PassageText view={view} token={token} />}
      <hr />
      {(view.items ?? []).map((item, n) => (
        <div key={item.id} style={{ marginBottom: 16 }}>
          <p>
            {n + 1}. {item.stem}
          </p>
          {item.options.map((o, i) => (
            <p key={i} style={{ margin: '2px 0' }}>
              <label>
                <input
                  type="radio"
                  name={item.id}
                  checked={answers[item.id] === i}
                  onChange={() => setAnswers({ ...answers, [item.id]: i })}
                />
                {o}
              </label>
            </p>
          ))}
        </div>
      ))}
      <button onClick={() => void submit()}>交卷</button>
      {submitError && <p role="alert">{submitError}</p>}
    </div>
  );
}

function Scales({ token, onDone }: { token: string; onDone: () => void }) {
  const [mentalEffort, setMentalEffort] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const labels = [
    '非常非常低', '非常低', '低', '稍低', '不低也不高',
    '稍高', '高', '非常高', '非常非常高',
  ];
  return (
    <div className="mental-effort-scale">
      <h3>請回答一個問題</h3>
      <fieldset>
        <legend>在剛才閱讀短文（二）時，你投入了多少心智努力？</legend>
        <p className="scale-hint">請選擇 1 至 9 的一個數字。</p>
        <div className="scale-options">
          {labels.map((label, index) => {
            const value = index + 1;
            return (
              <label key={value} className="scale-option">
                <input
                  type="radio"
                  name="mentalEffort"
                  value={value}
                  checked={mentalEffort === value}
                  onChange={() => setMentalEffort(value)}
                  disabled={posting}
                />
                <b>{value}</b>
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <button
        disabled={posting || mentalEffort === null}
        onClick={async () => {
          if (posting) return;
          setPosting(true); setError('');
          try {
          const response = await fetch('/api/scale', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, mentalEffort }),
          });
          if (!response.ok) { setError('送出失敗，請重試；目前選擇仍保留。'); return; }
          onDone();
          } catch { setError('連線失敗，請重試；目前選擇仍保留。'); }
          finally { setPosting(false); }
        }}
      >
        送出
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function Done({
  delayedPath,
  earliest,
  latest,
}: {
  delayedPath?: string;
  earliest?: string;
  latest?: string;
}) {
  if (!delayedPath) {
    return (
      <div>
        <h2>全部完成了，謝謝你。</h2>
      </div>
    );
  }
  const url = typeof window !== 'undefined' ? `${window.location.origin}${delayedPath}` : delayedPath;
  return (
    <div>
      <h2>今天的部分完成了，謝謝你。</h2>
      <p>
        最後一段在<b>明天</b>，大約 10 分鐘。請把下面這個連結存下來
        （複製起來，或直接把這一頁加入書籤）。
      </p>
      <p style={{ wordBreak: 'break-all', background: '#fff', padding: 8, border: '1px solid #ccc' }}>
        {url}
      </p>
      <p style={{ fontSize: 14, color: '#555' }}>
        可作答時間：<b>{earliest}</b>
        {latest && (
          <>
            {' '}
            到 <b>{latest}</b>
          </>
        )}
        ，只有這一天。太早或太晚打開都會顯示不能作答。
        本研究不寄送電子郵件，這個連結只會出現在這裡。
      </p>
    </div>
  );
}

export default function RunPage() {
  return (
    <Suspense fallback={<p>載入中…</p>}>
      <Runner />
    </Suspense>
  );
}
