import { NextRequest } from 'next/server';
import { gateway } from '@/server/gateway';
export const runtime = 'nodejs';
const handler = (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => gateway(request, context, 'student');
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD };
