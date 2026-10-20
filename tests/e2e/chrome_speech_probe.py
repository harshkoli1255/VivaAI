"""Observe native Chrome speech events and save the actual microphone capture."""
import asyncio
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / 'test-results/chrome-speech'


async def main():
    sample = ARTIFACTS / 'spoken.wav'
    if not sample.exists():
        raise RuntimeError('Generate test-results/chrome-speech/spoken.wav with real_provider_fixture.py first.')
    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
            self.wfile.write(b'<button id="start">Start native speech probe</button>')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless='--headed' not in sys.argv, args=['--disable-gpu', '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={sample}'])
        try:
            context = await asyncio.wait_for(browser.new_context(permissions=['microphone']), 45)
            page = await context.new_page()
            await page.goto(f'http://127.0.0.1:{server.server_port}')
            await page.evaluate("""() => {
              window.events = [];
              document.querySelector('#start').onclick = async () => {
                const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
                window.recorder = new MediaRecorder(stream);
                const chunks = [];
                recorder.ondataavailable = e => chunks.push(e.data);
                recorder.onstop = async () => {
                  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
                  window.captured = Array.from(bytes); stream.getTracks().forEach(t => t.stop());
                };
                recorder.start();
                const Native = window.SpeechRecognition || window.webkitSpeechRecognition;
                window.recognition = new Native(); recognition.lang = 'en-US';
                recognition.continuous = false; recognition.interimResults = true;
                for (const type of ['start','audiostart','soundstart','speechstart','result','error','end']) {
                  recognition.addEventListener(type, e => events.push({type, error:e.error,
                    text:type === 'result' ? Array.from(e.results).map(r => r[0].transcript).join(' ') : undefined}));
                }
                recognition.start(stream.getAudioTracks()[0]);
              };
            }""")
            await page.get_by_role('button').click()
            await asyncio.sleep(15)
            await page.evaluate('() => { recorder.stop(); recognition.stop(); }')
            for _ in range(45):
                if await page.evaluate("events.some(e => e.type === 'end')"):
                    break
                await asyncio.sleep(1)
            await page.evaluate('recognition.abort()')
            await page.wait_for_function('window.captured')
            (ARTIFACTS / 'microphone.webm').write_bytes(bytes(await page.evaluate('window.captured')))
            events = await page.evaluate('window.events')
            (ARTIFACTS / 'probe.json').write_text(json.dumps({'events':events,'headless':'--headed' not in sys.argv}, indent=2))
            results = [e['text'] for e in events if e['type'] == 'result']
            print(json.dumps({'result_count': len(results), 'last_transcript': results[-1] if results else None,
                              'errors': [e['error'] for e in events if e.get('error')]}))
        finally:
            await browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    asyncio.run(main())
