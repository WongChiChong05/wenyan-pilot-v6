import type { ReactNode } from 'react';

export const metadata = {
  title: '文言文閱讀研究',
  description: '國立清華大學資訊工程學系 大學部專題 — 先導研究',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body
        style={{
          fontFamily: '"Noto Serif TC", "Songti TC", serif',
          margin: 0,
          background: '#faf9f7',
          color: '#1a1a1a',
        }}
      >
        <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 64px' }}>{children}</main>
      </body>
    </html>
  );
}
