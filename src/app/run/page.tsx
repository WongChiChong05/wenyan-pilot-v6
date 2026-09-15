'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface StageView {
  stage: string;
  arm: string;
  seconds: { min: number; max: number };
  passage?: {
    id: string;
    title: string;
    text: string;
    annotations: { term: string; gloss: string }[];
    targets: { id: string; text: string }[];
    showAnnotations: boolean;
  };
  items?: { id: string; stem: string; options: string[]; level: string }[];
  lowerBound?: { required: number; done: number; met: boolean };
  config: { version: string };
}

interface AssistTurn {
  interactionId: string;
  kind: 'question' | 'choice' | 'reject' | 'explanation' | 'none';
  text: string;
  choice?: { prompt: string; options: string[] };
  completed: boolean;
  lowerBoundMet: boolean;
  degraded?: boolean;
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

  if (error) return <p style={{ color: '#a33' }}>{error}</p>;
  if (!view) return <p>載入中…</p>;

  if (view.stage === 'WAIT_DELAYED') {
    const v = view as unknown as { delayedPath: string; earliest: string };
    return <Done delayedPath={v.delayedPath} earliest={v.earliest} />;
  }
  if (view.stage === 'DONE') return <Done />;
  if (view.stage === 'S2') return <Reading view={view} token={token} onAdvance={advance} />;
  if (view.stage === 'S4') return <Scales token={token} onDone={load} />;
  if (view.items) {
    return (
      <Quiz
        key={view.stage}
        view={view}
        token={token}
        delayed={delayed}
        onDone={load}
        onTimeout={() => advance('timeout')}
      />
    );
  }
  return <p>（此階段沒有內容，請聯絡研究者）</p>;
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
}: {
  view: StageView;
  token: string;
  onSelect?: (s: string) => void;
}) {
  const passage = view.passage!;
  const annotated = useMemo(() => passage.annotations.map((a) => a.term), [passage.annotations]);

  const onMouseUp = () => {
    if (!onSelect) return;
    const sel = window.getSelection()?.toString().trim() ?? '';
    if (sel.length > 0) onSelect(sel);
  };

  return (
    <div onMouseUp={onMouseUp} style={{ lineHeight: 2, fontSize: 18, letterSpacing: 1 }}>
      <h3>{passage.title}</h3>
      <p>
        {passage.text.split('').map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
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

function Reading({
  view,
  token,
  onAdvance,
}: {
  view: StageView;
  token: string;
  onAdvance: (r: 'user' | 'timeout') => void;
}) {
  const [turn, setTurn] = useState<AssistTurn | null>(null);
  const [input, setInput] = useState('');
  const [choiceIndex, setChoiceIndex] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(view.lowerBound?.done ?? 0);
  const [met, setMet] = useState(view.lowerBound?.met ?? false);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    });
    const data = (await res.json()) as AssistTurn & { error?: string };
    if (data.error) return;
    setTurn(data);
    setMet(data.lowerBoundMet);
    if (data.completed) {
      setDone((d) => d + 1);
      setTurn(null);
    }
    setInput('');
    setChoiceIndex(null);
    setReason('');
  };

  return (
    <div>
      <Timer seconds={view.seconds.max} onTimeout={() => onAdvance('timeout')} />
      <p style={{ fontSize: 14 }}>
        用滑鼠選取你看不懂的地方。<b>底色標示的四句必須各問過一次</b>才能進入下一階段。
        目前完成 {done} / {view.lowerBound?.required ?? 4}。
      </p>
      <PassageText view={view} token={token} onSelect={(s) => void post({ action: 'highlight', selection: s })} />

      {view.arm === 'control' && (
        <p style={{ fontSize: 14, color: '#555' }}>（本組沒有 AI 回應，你的標記已記錄。）</p>
      )}

      {turn && turn.kind !== 'none' && (
        <div style={{ border: '1px solid #ccc', padding: 12, marginTop: 16, background: '#fff' }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</p>
          {turn.degraded && <p style={{ fontSize: 12, color: '#a33' }}>（系統暫時降級）</p>}

          {turn.kind === 'question' && (
            <>
              <textarea
                rows={2}
                style={{ width: '100%' }}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button onClick={() => void post({ action: 'answer', text: input })}>送出</button>
            </>
          )}

          {(turn.kind === 'choice' || turn.kind === 'reject') && turn.choice && (
            <>
              {turn.choice.options.map((o, i) => (
                <p key={i}>
                  <label>
                    <input
                      type="radio"
                      name="choice"
                      checked={choiceIndex === i}
                      onChange={() => setChoiceIndex(i)}
                    />
                    {o}
                  </label>
                </p>
              ))}
              <p>為什麼這樣選？（答錯沒關係）</p>
              <textarea
                rows={2}
                style={{ width: '100%' }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                disabled={choiceIndex === null}
                onClick={() => void post({ action: 'choice', index: choiceIndex, reason })}
              >
                送出
              </button>
            </>
          )}

          {turn.kind === 'explanation' && (
            <button onClick={() => void post({ action: 'read_done' })}>看完了</button>
          )}
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <button disabled={!met} onClick={() => onAdvance('user')}>
          {met ? '進入下一階段' : '尚未完成四句標記'}
        </button>
      </p>
    </div>
  );
}

function Quiz({
  view,
  token,
  delayed,
  onDone,
  onTimeout,
}: {
  view: StageView;
  token: string;
  delayed: boolean;
  onDone: () => void;
  onTimeout: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const startTs = useRef(Date.now());

  const submit = async () => {
    const payload = (view.items ?? []).map((i) => ({
      itemId: i.id,
      chosen: answers[i.id] ?? null,
      rtMs: Math.round((Date.now() - startTs.current) / (view.items?.length ?? 1)),
    }));
    await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, delayed, stage: view.stage, answers: payload }),
    });
    onDone();
  };

  return (
    <div>
      <Timer seconds={view.seconds.max} onTimeout={onTimeout} />
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
          <button onClick={() => setAnswers({ ...answers, [item.id]: null })} style={{ fontSize: 12 }}>
            跳過這題
          </button>
        </div>
      ))}
      <button onClick={() => void submit()}>交卷</button>
    </div>
  );
}

function Scales({ token, onDone }: { token: string; onDone: () => void }) {
  const [v, setV] = useState({ load: 4, frustration: 4, selfEfficacy: 4 });
  const row = (label: string, key: keyof typeof v) => (
    <p>
      {label}
      <input
        type="range"
        min={1}
        max={7}
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
      />
      {v[key]}
    </p>
  );
  return (
    <div>
      <h3>請回答三個問題（1 = 非常低，7 = 非常高）</h3>
      {row('剛才閱讀時的心力負擔：', 'load')}
      {row('剛才閱讀時的挫折感：', 'frustration')}
      {row('你覺得自己現在讀文言文的能力：', 'selfEfficacy')}
      <button
        onClick={async () => {
          await fetch('/api/scale', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, ...v }),
          });
          onDone();
        }}
      >
        送出
      </button>
    </div>
  );
}

function Done({ delayedPath, earliest }: { delayedPath?: string; earliest?: string }) {
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
        請把下面這個連結存下來，<b>{earliest} 之後</b>（最晚七天內）再花約 10 分鐘完成最後一段。
        本研究不寄送電子郵件，連結只會出現在這裡。
      </p>
      <p style={{ wordBreak: 'break-all', background: '#fff', padding: 8, border: '1px solid #ccc' }}>
        {url}
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
