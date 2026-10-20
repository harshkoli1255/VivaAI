import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { Navbar } from '@/components/ui/Navbar';

export const metadata: Metadata = {
  title: 'VivaAI — Student Oral Examination Portal',
  description:
    'Calibrated academic oral viva examinations with real-time acoustic dialogue, verifiable question progression, and transparent assessment records.',
  keywords: ['viva', 'oral exam', 'technical interview', 'academic assessment', 'student portal'],
  authors: [{ name: 'VivaAI' }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="font-sans antialiased" suppressHydrationWarning>
        <AuthProvider><ThemeProvider>
          <ToastProvider>
            <div className="min-h-screen flex flex-col">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--primary)] focus:text-[var(--primary-fg)] focus:rounded-md focus:shadow-lg focus:outline-none text-xs font-semibold"
              >
                Skip to main content
              </a>
              <Navbar appMode="student" />
              <main id="main-content" className="flex-1">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider></AuthProvider>
      </body>
    </html>
  );
}
