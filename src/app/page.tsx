'use client';

import { useState } from 'react';

export default function ConsentPage() {
  const [form, setForm] = useState({
    age: '',
    gender: '',
    major: '',
    email: '',
    grade: '',
    aiUsage: '每週數次',
    chineseMajor: false,
    readBefore: false,
    consent: false,
  });
  const [msg, setMsg] = useState('');

  async function submit() {
    if (!form.consent) return setMsg('請先勾選同意參與。');
    if (!/^\d+$/.test(form.age) || Number(form.age) < 16 || Number(form.age) > 80) return setMsg('請輸入 16 至 80 歲的整數年齡。');
    if (!form.gender || !form.major.trim() || !form.email.trim()) return setMsg('年齡、性別、主修／系所及電郵都是必填欄位。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setMsg('請輸入有效的電郵地址。');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, age: Number(form.age) }),
    });
    const data = (await res.json()) as { token?: string; eligible?: boolean; error?: string };
    if (!data.token) return setMsg(data.error ?? '發生錯誤');
    if (!data.eligible) {
      setMsg('感謝你的參與意願。依本研究的條件，你的資料不會納入分析，但仍可繼續作答。');
    }
    window.location.href = `/run?t=${data.token}`;
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1>文言文閱讀研究</h1>
      <p>國立清華大學資訊工程學系 大學部專題（先導研究）</p>
      <h2>參與說明</h2>
      <ul>
        <li>今天約 40 分鐘，<b>明天</b>還有一次約 10 分鐘的追蹤測驗（連結在今天結束時給你）。</li>
        <li>今天會閱讀三篇文言文，追蹤測驗再閱讀一篇，並回答選擇題；閱讀過程中可能有 AI 輔助。</li>
        <li>作答資料以研究編號保存，不收姓名。電郵只用於寄送明天的追蹤測驗連結，與作答資料分開保存，並在追蹤測驗完成或期限結束後刪除。</li>
        <li>作答時頁面會進入全螢幕，中途切換視窗或離開全螢幕會被記錄（只記錄次數，不會錄影或截圖）。</li>
        <li>你可以隨時關閉頁面退出，不會有任何影響。</li>
      </ul>

      <h2>基本資料</h2>
      <p>
        <label>
          年齡（必填）：
          <input
            type="number"
            min={16}
            max={80}
            required
            value={form.age}
            onChange={(e) => setForm({ ...form, age: e.target.value })}
          />
        </label>
      </p>
      <p>
        <label>
          性別（必填）：
          <select required value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">請選擇</option>
            <option>男性</option>
            <option>女性</option>
            <option>非二元／其他</option>
            <option>不願透露</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          主修／系所（必填）：
          <input required value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} />
        </label>
      </p>
      <p>
        <label>
          電郵（必填，只用於追蹤測驗）：
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
      </p>
      <p>
        <label>
          年級（選填）：
          <input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
        </label>
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
