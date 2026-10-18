import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('vivaai_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('vivaai_token');
      localStorage.removeItem('vivaai_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ────────────────────────────────────────────
export const authApi = {
  login: (data: { student_id?: string; email?: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: { name: string; student_id?: string; email?: string; password: string; role?: string }) =>
    api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

// ── Sessions ─────────────────────────────────────────
export const sessionsApi = {
  create: (data: { viva_config_id: string; consent_given?: boolean }) =>
    api.post('/sessions', data),
  mySessions: () => api.get('/sessions/my'),
  get: (id: string) => api.get(`/sessions/${id}`),
  start: (id: string) => api.post(`/sessions/${id}/start`),
  end: (id: string) => api.post(`/sessions/${id}/end`),
  consent: (id: string) => api.post(`/sessions/${id}/consent`),
  override: (id: string, data: { override_score: number; reason: string }) =>
    api.post(`/sessions/${id}/override`, data),
};

// ── Viva Configs ──────────────────────────────────────
export const configsApi = {
  list: () => api.get('/viva-configs'),
  get: (id: string) => api.get(`/viva-configs/${id}`),
  create: (data: object) => api.post('/viva-configs', data),
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
  exportCsv: (status?: string) =>
    api.get('/dashboard/export/csv', { params: { status }, responseType: 'blob' }),
};

// ── Transcript ────────────────────────────────────────
export const transcriptApi = {
  get: (sessionId: string) => api.get(`/transcript/${sessionId}`),
};

// ── Scores ────────────────────────────────────────────
export const scoresApi = {
  get: (sessionId: string) => api.get(`/scores/${sessionId}`),
};
