import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '文言文閱讀研究',
  description: '國立清華大學資訊工程學系 大學部專題 — 先導研究',
};

/**
 * The page width is NOT fixed here any more. S2 needs room for the conversation
 * sidebar (680 passage + 24 gap + 360 sidebar), every other screen stays narrow.
 * Each page sets its own wrapper width; see `Shell` in run/page.tsx.
 */
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
        <main style={{ padding: '24px 16px 64px' }}>{children}</main>
      </body>
    </html>
  );
}
