import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { Navbar } from '@/components/ui/Navbar';

export const metadata: Metadata = {
  title: 'VivaAI — University Oral Technical Viva Examination Platform',
  description:
    'A standardized, auditable 15-minute voice examination for academic cohorts with verbatim turn citations, calibrated rubrics, and sovereign faculty review.',
  keywords: ['viva', 'oral exam', 'technical interview', 'academic assessment', 'higher education'],
  authors: [{ name: 'VivaAI' }],
  openGraph: {
    title: 'VivaAI — University Technical Viva Examiner',
    description: 'Standardized 15-minute oral examinations with auditable citations and sovereign faculty oversight.',
    type: 'website',
  },
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
              <Navbar />
              <main className="flex-1">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider></AuthProvider>
      </body>
    </html>
  );
}
