import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const browserErrorLogger = `
(() => {
  const endpoint = '/__client-log';
  const lastReport = new Map();
  const describe = (value) => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (typeof value === 'string') return { message: value };
    try { return { message: JSON.stringify(value) }; }
    catch { return { message: String(value) }; }
  };
  const report = (type, value, extra = {}) => {
    const description = describe(value);
    const key = type + ':' + description.message;
    const now = Date.now();
    if (now - (lastReport.get(key) || 0) < 1000) return;
    lastReport.set(key, now);
    const payload = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      ...description,
      ...extra,
    });
    if (!navigator.sendBeacon?.(endpoint, new Blob([payload], { type: 'application/json' }))) {
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  };
  window.addEventListener('error', (event) => {
    report('error', event.error || event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
    if (/ResizeObserver loop/i.test(String(event.message))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('unhandledrejection', (event) => report('unhandledrejection', event.reason));
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'AR4 Studio — MK5 Robot Simulator',
  description: 'Interactive six-axis digital twin for the Annin Robotics AR4 MK5.',
  openGraph: {
    title: 'AR4 Studio — MK5 Robot Simulator',
    description: 'Control and explore an interactive six-axis AR4 MK5 digital twin.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AR4 Studio — MK5 Robot Simulator',
    description: 'Control and explore an interactive six-axis AR4 MK5 digital twin.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: browserErrorLogger }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
