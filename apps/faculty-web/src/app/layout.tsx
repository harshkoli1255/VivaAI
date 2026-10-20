import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { Navbar } from '@/components/ui/Navbar';

export const metadata: Metadata = {
  title: 'VivaAI — Faculty Assessment & Review Portal',
  description:
    'Faculty workspace for oral assessment review with transcripts, available recordings, rubric breakdowns, and score adjustments.',
  keywords: ['faculty review', 'oral assessment', 'rubric scoring', 'academic integrity', 'transcript citations'],
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
              <Navbar appMode="faculty" />
              <main id="main-content" className="flex-1">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider></AuthProvider>
      </body>
    </html>
  );
}
