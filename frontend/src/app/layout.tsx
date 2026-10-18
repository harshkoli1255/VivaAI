import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';

import { Navbar } from '@/components/ui/Navbar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VivaAI — AI-Powered Technical Viva Examiner',
  description:
    'A fair, auditable 15-minute AI technical viva for students with comprehensive faculty review dashboard.',
  keywords: ['viva', 'AI', 'interview', 'examination', 'assessment'],
  authors: [{ name: 'VivaAI' }],
  openGraph: {
    title: 'VivaAI',
    description: 'AI-Powered Technical Viva Examiner',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <ToastProvider>
            <div className="min-h-screen flex flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
