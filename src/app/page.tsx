'use client';

import { useState } from 'react';

export default function ConsentPage() {
  const [form, setForm] = useState({
    grade: '',
    department: '',
    aiUsage: '每週數次',
    chineseMajor: false,
    readBefore: false,
    consent: false,
  });
  const [msg, setMsg] = useState('');

  async function submit() {
    if (!form.consent) return setMsg('請先勾選同意參與。');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = (await res.json()) as { token?: string; eligible?: boolean; error?: string };
    if (!data.token) return setMsg(data.error ?? '發生錯誤');
    if (!data.eligible) {
      setMsg('感謝你的參與意願。依本研究的條件，你的資料不會納入分析，但仍可繼續作答。');
    }
    window.location.href = `/run?t=${data.token}`;
  }

  return (
    <div>
      <h1>文言文閱讀研究</h1>
      <p>國立清華大學資訊工程學系 大學部專題（先導研究）</p>
      <h2>參與說明</h2>
      <ul>
        <li>全程約 40 分鐘，3–7 天後有一次約 10 分鐘的追蹤測驗。</li>
        <li>你會閱讀兩段文言文並回答選擇題，過程中可能有 AI 輔助。</li>
        <li>資料只以匿名編號儲存，不收姓名與電子郵件。</li>
        <li>你可以隨時關閉頁面退出，不會有任何影響。</li>
      </ul>

      <h2>基本資料</h2>
      <p>
        年級：
        <input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
      </p>
      <p>
        系所：
        <input
          value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })}
        />
      </p>
      <p>
        平常使用 AI 工具的頻率：
        <select value={form.aiUsage} onChange={(e) => setForm({ ...form, aiUsage: e.target.value })}>
          <option>幾乎不用</option>
          <option>每月數次</option>
          <option>每週數次</option>
          <option>每天使用</option>
        </select>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={form.chineseMajor}
            onChange={(e) => setForm({ ...form, chineseMajor: e.target.checked })}
          />
          我是中文系（或中國文學相關科系）學生
        </label>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={form.readBefore}
            onChange={(e) => setForm({ ...form, readBefore: e.target.checked })}
          />
          我讀過《世說新語·汰侈》中石崇、王愷鬥富的故事
        </label>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => setForm({ ...form, consent: e.target.checked })}
          />
          我已閱讀上述說明，同意參與
        </label>
      </p>
      <button onClick={submit}>開始</button>
      {msg && <p style={{ color: '#a33' }}>{msg}</p>}
    </div>
  );
}
