import { NextRequest } from 'next/server';
import { gateway } from '@/server/gateway';
export function GET(request: NextRequest) {
  return gateway(request, { params: Promise.resolve({ path: ['tts', 'synthesize'] }) }, 'student');
}
