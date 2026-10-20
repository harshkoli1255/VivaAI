import axios from 'axios';

// All browser REST traffic stays on the portal origin.
export const resolveApiUrl = (): string => '';
export const api = axios.create({
  baseURL: '/api/v1', timeout: 60000, withCredentials: true,
  headers: { 'Content-Type': 'application/json', 'X-VivaAI-Request': '1' },
});
api.interceptors.response.use((res) => res, (err) => {
  if (err.response?.status === 401 && typeof window !== 'undefined'
      && !['/auth/login', '/auth/register', '/auth/me'].includes(err.config?.url || '')) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }
  return Promise.reject(err);
});

// ── Auth ────────────────────────────────────────────
export const authApi = {
  login: (data: { student_id?: string; email?: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: { name: string; student_id?: string; email?: string; password: string; role?: string }) =>
    api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
};

// ── Sessions ─────────────────────────────────────────
export const sessionsApi = {
  create: (data: { viva_config_id: string; consent_given?: boolean }) =>
    api.post('/sessions', data),
  scoring: (id: string) => api.get<{ status: string; attempts: number; message: string | null }>(`/sessions/${id}/scoring`),
  retryScoring: (id: string) => api.post(`/sessions/${id}/scoring/retry`),
  mySessions: () => api.get('/sessions/my'),
  get: (id: string) => api.get(`/sessions/${id}`),
  start: (id: string) => api.post(`/sessions/${id}/start`),
  end: (id: string) => api.post(`/sessions/${id}/end`),
  consent: (id: string) => api.post(`/sessions/${id}/consent`),
  getWsTicket: (id: string) => api.post<{ ticket: string; expires_in: number }>(`/sessions/${id}/ws-ticket`),
  getAudioUrl: (id: string) => api.get<{ audio_url: string; session_id: string }>(`/sessions/${id}/audio`),
  uploadAudio: (id: string, fileOrBlob: Blob | File) => {
    const form = new FormData();
    form.append('file', fileOrBlob, `session_${id}.webm`);
    return api.post(`/sessions/${id}/audio`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getStreamAudioUrl: (id: string) => {
    const base = resolveApiUrl();
    return `${base}/api/v1/sessions/${id}/audio/stream`;
  },
  override: (id: string, data: { override_score: number; reason: string }) =>
    api.post(`/sessions/${id}/override`, data),
};

// ── Viva Configs ──────────────────────────────────────
export const configsApi = {
  list: () => api.get('/viva-configs'),
  get: (id: string) => api.get(`/viva-configs/${id}`),
  create: (data: object) => api.post('/viva-configs', data),
  generatePreviewQuestions: (data: { syllabus: string; subject?: string; difficulty?: string; count?: number }) =>
    api.post<{ questions: Array<{ id: string; text: string; phase: string; topic: string; difficulty: string; status: 'approved' | 'rejected' | 'pending'; is_ai_generated: boolean }> }>('/viva-configs/generate-preview-questions', data),
  generateQuestions: (id: string, syllabus: string, count: number) =>
    api.post(`/viva-configs/${id}/generate-questions`, null, {
      params: { syllabus, count },
    }),
  uploadQuestions: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/viva-configs/${id}/upload-questions`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Questions ─────────────────────────────────────────
export const questionsApi = {
  list: (configId: string, status?: string) =>
    api.get(`/questions/config/${configId}`, { params: { status } }),
  review: (id: string, data: { status: string; note?: string }) =>
    api.patch(`/questions/${id}/review`, data),
  update: (id: string, data: object) => api.patch(`/questions/${id}`, data),
  delete: (id: string) => api.delete(`/questions/${id}`),
};

// ── Dashboard ─────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  sessions: (params?: object) => api.get('/dashboard/sessions', { params }),
  sessionDetail: (id: string) => api.get(`/dashboard/sessions/${id}/detail`),
  exportCsv: (status?: string, search?: string) =>
    api.get('/dashboard/export/csv', { params: { status, search }, responseType: 'blob' }),
};

// ── Transcript ────────────────────────────────────────
export const transcriptApi = {
  get: (sessionId: string) => api.get(`/transcript/${sessionId}`),
};

// ── Scores ────────────────────────────────────────────
export const scoresApi = {
  get: (sessionId: string) => api.get(`/scores/${sessionId}`),
  getPdf: (sessionId: string) =>
    api.get(`/scores/${sessionId}/pdf`, { responseType: 'blob' }),
};
