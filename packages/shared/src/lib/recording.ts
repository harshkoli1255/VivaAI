/** Browser recording write-ahead log. Delete a fragment only after server acknowledgement. */
type Fragment = { id: string; sessionId: string; captureId: string; sequence: number; startSecs: number; recordingKind?: "candidate" | "conversation"; data: Blob };
let database: Promise<IDBDatabase> | null = null;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vivaai-recordings', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('fragments', { keyPath: 'id' });
      store.createIndex('sessionId', 'sessionId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
async function write(fragment: Fragment) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('fragments', 'readwrite');
    tx.objectStore('fragments').put(fragment);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Recording could not be saved on this device'));
  });
}
async function pending(sessionId: string): Promise<Fragment[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('fragments').objectStore('fragments').index('sessionId').getAll(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function remove(id: string) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('fragments', 'readwrite');
    tx.objectStore('fragments').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const flushing = new Map<string, Promise<void>>();
export function syncRecording(sessionId: string): Promise<void> {
  const current = flushing.get(sessionId);
  if (current) return current;
  const work = (async () => {
    const fragments = await pending(sessionId);
    fragments.sort((a, b) => a.startSecs - b.startSecs || a.captureId.localeCompare(b.captureId) || a.sequence - b.sequence);
    for (const fragment of fragments) {
      const query = new URLSearchParams({ capture_id: fragment.captureId, sequence: String(fragment.sequence), start_secs: String(fragment.startSecs), recording_kind: fragment.recordingKind || "candidate" });
      const response = await fetch(`/api/v1/sessions/${sessionId}/recording/chunks/${fragment.id}?${query}`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'X-VivaAI-Request': '1', 'Content-Type': fragment.data.type || 'audio/webm' },
        body: fragment.data, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Recording is saved on this device and will retry syncing when the connection recovers.');
      await remove(fragment.id);
    }
  })().finally(() => flushing.delete(sessionId));
  flushing.set(sessionId, work);
  return work;
}

export class DurableRecorder {
  private recorder: MediaRecorder;
  private writes = Promise.resolve();
  private persistenceError: unknown = null;
  private sequence = 0;
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private stoppedEvent: Promise<void>;
  private readonly captureId = crypto.randomUUID();
  private stopPromise: Promise<void> | null = null;
  constructor(stream: MediaStream, private sessionId: string, private startSecs: number, private report: (message: string) => void, private recordingKind: "candidate" | "conversation" = "candidate") {
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    this.stoppedEvent = new Promise<void>((resolve) => {
      this.recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    this.recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const fragment: Fragment = { id: crypto.randomUUID(), sessionId, captureId: this.captureId,
        sequence: this.sequence++, startSecs, recordingKind: this.recordingKind, data: new Blob([event.data], { type: this.recorder.mimeType }) };
      this.writes = this.writes.then(() => write(fragment)).catch((error) => {
        this.persistenceError = error;
        this.report('Recording could not be saved on this device. Please keep this tab open and contact faculty.');
      });
    };
    this.recorder.onerror = () => this.report('Recording was interrupted. Reconnect your microphone and retry.');
    this.recorder.start(250);
    this.timer = setInterval(() => { void this.sync(); }, 1000);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('pagehide', this.onPageHide);
    this.report('Recording: saving continuously');
    void this.sync();
  }
  private onOnline = () => { void this.sync(); };
  private onPageHide = () => { void this.stop().catch(() => {}); };
  private async sync() {
    try {
      await this.writes;
      if (this.persistenceError) throw this.persistenceError;
      await syncRecording(this.sessionId);
      if (!this.stopped) this.report('Recording: saved and syncing continuously');
    } catch (error) {
      this.report(error instanceof Error ? error.message : 'Recording is waiting to sync.');
    }
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    clearInterval(this.timer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('pagehide', this.onPageHide);
    this.stopPromise = (async () => {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      await this.stoppedEvent;
      await this.writes;
      if (this.persistenceError) throw this.persistenceError;
      // An earlier flush may have started before the final dataavailable event.
      await syncRecording(this.sessionId);
      await syncRecording(this.sessionId);
      this.report('Recording: saved');
    })().catch((error) => { this.stopPromise = null; throw error; });
    return this.stopPromise;
  }
}
