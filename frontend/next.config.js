/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    '*.trycloudflare.com',
    'beads-cornell-resistant-patches.trycloudflare.com',
    'shield-developed-fioricet-mixture.trycloudflare.com',
    'flex-cashiers-conclusion-ask.trycloudflare.com',
    'localhost:3000',
    'localhost:3001',
  ],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? 'https://vivaai-848e.onrender.com' : 'http://localhost:8000'),
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || (process.env.NODE_ENV === 'production' ? 'wss://vivaai-848e.onrender.com' : 'ws://localhost:8000'),
    NEXT_PUBLIC_STUDENT_URL: process.env.NEXT_PUBLIC_STUDENT_URL || (process.env.NODE_ENV === 'production' ? 'https://viva-ai-delta.vercel.app' : 'http://localhost:3000'),
    NEXT_PUBLIC_FACULTY_URL: process.env.NEXT_PUBLIC_FACULTY_URL || (process.env.NODE_ENV === 'production' ? 'https://viva-ai-8asv.vercel.app' : 'http://localhost:3001'),
    NEXT_PUBLIC_MOCK_MODE: process.env.NEXT_PUBLIC_MOCK_MODE || (process.env.NODE_ENV === 'production' ? 'false' : 'true'),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
