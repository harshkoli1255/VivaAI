import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

// In-memory or disk cache for instant playback
const CACHE_DIR = path.join(os.tmpdir(), 'vivaai_tts_cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim();

  if (!text) {
    return new NextResponse('Text query parameter is required', { status: 400 });
  }

  const voice = searchParams.get('voice') || 'Samantha';
  const hash = crypto.createHash('md5').update(`${voice}_${text}`).digest('hex');
  const cachedFilePath = path.join(CACHE_DIR, `${hash}.wav`);

  try {
    // Return cached audio if already synthesized
    if (fs.existsSync(cachedFilePath)) {
      const buffer = fs.readFileSync(cachedFilePath);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    }

    // Synthesize using macOS say
    const sayPath = '/usr/bin/say';
    if (fs.existsSync(sayPath)) {
      const tempOut = path.join(CACHE_DIR, `temp_${hash}.wav`);
      await execFileAsync(sayPath, [
        '-v',
        voice,
        '-o',
        tempOut,
        '--data-format=LEI16@22050',
        text,
      ]);

      if (fs.existsSync(tempOut)) {
        fs.renameSync(tempOut, cachedFilePath);
        const buffer = fs.readFileSync(cachedFilePath);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'public, max-age=86400, immutable',
          },
        });
      }
    }

    // Fallback: generate clean PCM sine tone if say is unavailable
    const sampleRate = 22050;
    const durationSec = 1.0;
    const numSamples = Math.floor(sampleRate * durationSec);
    const dataSize = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
      const val = Math.floor(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000);
      buffer.writeInt16LE(val, 44 + i * 2);
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('TTS synthesis error:', err);
    return new NextResponse(`TTS generation failed: ${err.message}`, { status: 500 });
  }
}
