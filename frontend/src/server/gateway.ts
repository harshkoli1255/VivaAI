import { NextRequest, NextResponse } from 'next/server';

function getUpstreamBaseUrl(): string {
  const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const configured =
    process.env.API_INTERNAL_URL ||
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL;

  if (configured) {
    if (isProd && (configured.includes('localhost') || configured.includes('127.0.0.1'))) {
      return 'https://vivaai-848e.onrender.com';
    }
    return configured;
  }
  return isProd ? 'https://vivaai-848e.onrender.com' : 'http://127.0.0.1:8000';
}

/** Same-origin API boundary: browser JavaScript never receives authentication tokens. */
export async function gateway(req: NextRequest, context: { params: Promise<{ path: string[] }> }, portal: 'student' | 'faculty' = 'student') {
  const { path } = await context.params;
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const origin = req.headers.get('origin');
  if (unsafe) {
    if (req.headers.get('x-vivaai-request') !== '1') {
      return NextResponse.json({ detail: 'Untrusted request origin' }, { status: 403 });
    }
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostHeader = req.headers.get('host') || req.nextUrl.host;
        const forwardedHost = req.headers.get('x-forwarded-host');
        const allowedHosts = new Set(
          [hostHeader, forwardedHost, req.nextUrl.host, 'localhost:3000', 'localhost:3001', '127.0.0.1:3000', '127.0.0.1:3001'].filter(Boolean)
        );
        const isAllowed =
          allowedHosts.has(originUrl.host) ||
          allowedHosts.has(originUrl.hostname) ||
          originUrl.hostname.endsWith('.trycloudflare.com') ||
          originUrl.hostname.endsWith('.vercel.app') ||
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === '127.0.0.1';
        if (!isAllowed) {
          return NextResponse.json({ detail: 'Untrusted request origin' }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ detail: 'Untrusted request origin' }, { status: 403 });
      }
    }
  }
  if (Number(req.headers.get('content-length') || 0) > 52 * 1024 * 1024) {
    return NextResponse.json({ detail: 'Request too large' }, { status: 413 });
  }
  const base = getUpstreamBaseUrl();
  const upstream = new URL(`/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, base);
  const headers = new Headers();
  for (const name of ['content-type', 'accept', 'range']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const backendCookie = process.env.SESSION_COOKIE_NAME || 'vivaai_session';
  const cookieName = `${backendCookie}_${portal}`;
  const session = req.cookies.get(cookieName);
  if (session) headers.set('cookie', `${backendCookie}=${session.value}`);
  try {
    const response = await fetch(upstream, {
      method: req.method, headers, cache: 'no-store',
      body: unsafe ? await req.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(60000), redirect: 'manual',
    });
    const outputHeaders = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const name of ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) outputHeaders.set(name, value);
    }
    // Private storage redirects are fetched by the backend; never expose an upstream auth cookie.
    let body: BodyInit | null = response.body;
    if (req.method !== 'HEAD' && response.headers.get('content-type')?.includes('application/json')) {
      const json = await response.json();
      if (json && typeof json === 'object') {
        delete json.access_token;
        delete json.token_type;
        if (json.ticket) {
          const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
          if (!json.ws_url || (isProd && (json.ws_url.includes('localhost') || json.ws_url.includes('127.0.0.1')))) {
            json.ws_url = isProd ? 'wss://vivaai-848e.onrender.com' : (process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8000');
          }
        }
      }
      body = JSON.stringify(json);
    }
    const output = new NextResponse(body, { status: response.status, headers: outputHeaders });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';');
      const split = pair.indexOf('=');
      if (pair.slice(0, split) !== backendCookie) continue;
      const maxAge = /max-age=(\d+)/i.exec(value);
      const isHttps = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
      output.cookies.set(cookieName, pair.slice(split + 1), {
        httpOnly: true, secure: isHttps, sameSite: 'lax', path: '/',
        maxAge: maxAge ? Number(maxAge[1]) : 86400,
      });
    }
    return output;
  } catch {
    return NextResponse.json({ detail: 'The examination service is unavailable. Please retry.' }, { status: 503 });
  }
}
