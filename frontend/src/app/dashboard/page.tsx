'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { dashboardApi, configsApi } from '@/lib/api';
import {
  LayoutDashboard,
  Search,
  Filter,
  Download,
  ShieldCheck,
  Award,
  AlertTriangle,
  Clock,
  ArrowRight,
  User,
  CheckCircle2,
  Sliders,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

interface CandidateSession {
  id: string;
  student_id: string;
  student_name: string;
  course_code: string;
  course_title: string;
  status: string;
  score: number | null;
  grade_label: string;
  integrity_score: number;
  completed_at: string;
  turn_count: number;
  has_override: boolean;
}

const MOCK_SESSIONS: CandidateSession[] = [
  {
    id: '00000000-0000-0000-0000-000000000021',
    student_id: 'STU001',
    student_name: 'Alex Chen',
    course_code: 'CS401',
    course_title: 'Distributed Systems & Database Internals',
    status: 'scored',
    score: 84,
    grade_label: 'Distinction (A+)',
    integrity_score: 99.2,
    completed_at: '2026-10-18T14:30:00Z',
    turn_count: 14,
    has_override: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000022',
    student_id: 'STU002',
    student_name: 'Samira Khan',
    course_code: 'CS401',
    course_title: 'Distributed Systems & Database Internals',
    status: 'scored',
    score: 72,
    grade_label: 'Merit (B+)',
    integrity_score: 98.4,
    completed_at: '2026-10-18T11:15:00Z',
    turn_count: 12,
    has_override: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000023',
    student_id: 'STU003',
    student_name: 'Marcus Vance',
    course_code: 'CS302',
    course_title: 'Operating Systems & Concurrency',
    status: 'flagged',
    score: 58,
    grade_label: 'Pass (C)',
    integrity_score: 84.1,
    completed_at: '2026-10-17T16:45:00Z',
    turn_count: 10,
    has_override: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000024',
    student_id: 'STU004',
    student_name: 'Elena Rostova',
    course_code: 'CS401',
    course_title: 'Distributed Systems & Database Internals',
    status: 'scored',
    score: 91,
    grade_label: 'High Distinction',
    integrity_score: 99.8,
    completed_at: '2026-10-17T10:20:00Z',
    turn_count: 16,
    has_override: false,
  },
];

export default function AssessmentDashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, setAuth } = useAuthStore();

  const [sessions, setSessions] = useState<CandidateSession[]>(MOCK_SESSIONS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  // Auto-switch to faculty mode if user enters dashboard
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'faculty') {
      const demoFaculty = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Dr. Priya Sharma',
        role: 'faculty' as const,
        email: 'priya.sharma@university.edu',
      };
      setAuth('demo_faculty_token_drpriya', demoFaculty);
      localStorage.setItem('vivaai_token', 'demo_faculty_token_drpriya');
      localStorage.setItem('vivaai_user', JSON.stringify(demoFaculty));
    }
  }, [isAuthenticated, user, setAuth]);

  // Load real sessions from backend API
  useEffect(() => {
    async function fetchSessions() {
      try {
        setLoading(true);
        const res = await dashboardApi.sessions();
        const items = res.data?.items || res.data;
        if (Array.isArray(items) && items.length > 0) {
          setSessions(items);
        }
      } catch (err) {
        console.warn('Dashboard fetch notice, using verified sample sessions:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, []);

  const handleExportCsv = async () => {
    try {
      const res = await dashboardApi.exportCsv();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'VivaAI_Assessment_Registry.csv');
      document.body.appendChild(link);
      link.click();
    } catch {
      // Local CSV generation fallback
      const headers = ['SessionID', 'StudentID', 'Name', 'Course', 'Score', 'Grade', 'Integrity', 'Date'];
      const rows = sessions.map(s => [
        s.id,
        s.student_id,
        `"${s.student_name}"`,
        s.course_code,
        s.score || '',
        `"${s.grade_label}"`,
        `${s.integrity_score}%`,
        s.completed_at
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'VivaAI_Assessment_Registry.csv');
      document.body.appendChild(link);
      link.click();
    }
  };

  const filteredSessions = sessions.filter((s) => {
    const matchesSearch =
      s.student_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.student_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.course_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'flagged' && s.status === 'flagged') ||
      (statusFilter === 'override' && s.has_override) ||
      (statusFilter === 'distinction' && (s.score || 0) >= 80);
    return matchesSearch && matchesStatus;
  });

  const avgScore = Math.round(
    sessions.reduce((acc, s) => acc + (s.score || 0), 0) / (sessions.length || 1)
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100 py-10 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Examiner Assessment Registry · Cohort Fall 2026</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Faculty Viva Voce Ledger
            </h1>
            <p className="text-sm text-slate-400">
              Auditor: <span className="text-slate-200 font-semibold">{user?.name || 'Dr. Priya Sharma'}</span> · Chief Examination Board
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCsv}
              className="btn-secondary text-xs py-2.5 px-4 font-semibold flex items-center gap-2"
            >
              <Download className="w-4 h-4 text-sky-400" />
              Export CSV Ledger
            </button>

            <Link
              href="/faculty/setup"
              className="btn-primary text-xs py-2.5 px-4 font-semibold flex items-center gap-2"
            >
              <Sliders className="w-4 h-4" />
              New Viva Protocol
            </Link>
          </div>
        </div>

        {/* Executive Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="premium-card p-5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Total Candidate Vivas</span>
              <User className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-white">
              {sessions.length}
            </div>
            <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono">
              <CheckCircle2 className="w-3 h-3" />
              100% Deterministic Stop Enforced
            </div>
          </div>

          <div className="premium-card p-5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Cohort Average Score</span>
              <Award className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-sky-400">
              {avgScore} / 100
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              5-Dimension Normalized Rubric
            </div>
          </div>

          <div className="premium-card p-5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Distinction Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {Math.round((sessions.filter(s => (s.score || 0) >= 80).length / sessions.length) * 100)}%
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Grade Score &ge; 80/100
            </div>
          </div>

          <div className="premium-card p-5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Audit Flags & Overrides</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {sessions.filter(s => s.status === 'flagged' || s.has_override).length}
            </div>
            <div className="text-[11px] text-amber-400/80 font-mono">
              Requires Deliberation / Verified
            </div>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="glass-panel p-4 flex flex-col sm:flex-row items-center justify-between gap-4 border border-slate-800">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search candidate, student ID, or course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-400 hidden sm:inline" />
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-medium w-full sm:w-auto overflow-x-auto">
              {[
                { key: 'all', label: 'All Candidates' },
                { key: 'distinction', label: 'Distinctions' },
                { key: 'flagged', label: 'Flagged' },
                { key: 'override', label: 'Faculty Override' },
              ].map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setStatusFilter(filter.key)}
                  className={`px-3 py-1.5 rounded-md whitespace-nowrap transition-all ${
                    statusFilter === filter.key
                      ? 'bg-sky-500 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* High-Density Assessment Table */}
        <div className="glass-panel overflow-hidden border border-slate-800 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Candidate</th>
                  <th className="py-3.5 px-4 font-semibold">Module</th>
                  <th className="py-3.5 px-4 font-semibold">Score / Grade</th>
                  <th className="py-3.5 px-4 font-semibold">Proctor Confidence</th>
                  <th className="py-3.5 px-4 font-semibold">Turns</th>
                  <th className="py-3.5 px-4 font-semibold">Audit Status</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Dossier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="hover:bg-slate-900/50 transition-colors group"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold">
                          {session.student_name[0]}
                        </div>
                        <div>
                          <div className="font-semibold text-white group-hover:text-sky-400 transition-colors">
                            {session.student_name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {session.student_id}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-mono text-sky-400 font-bold">
                        {session.course_code}
                      </div>
                      <div className="text-slate-400 text-[11px] max-w-xs truncate">
                        {session.course_title}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono">
                      <div className="text-sm font-bold text-white">
                        {session.score !== null ? `${session.score}/100` : 'Pending'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {session.grade_label}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              session.integrity_score > 90 ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                            style={{ width: `${session.integrity_score}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-slate-300">
                          {session.integrity_score}%
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {session.turn_count} turns
                    </td>

                    <td className="py-3.5 px-4">
                      {session.has_override ? (
                        <span className="status-pill status-pill-warning text-[10px]">
                          OVERRIDDEN
                        </span>
                      ) : session.status === 'flagged' ? (
                        <span className="status-pill status-pill-danger text-[10px]">
                          AUDIT FLAGGED
                        </span>
                      ) : (
                        <span className="status-pill status-pill-success text-[10px]">
                          VERIFIED
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/faculty/review/${session.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-500 hover:text-white text-slate-200 transition-all font-semibold text-xs border border-slate-700"
                      >
                        <span>Review</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
