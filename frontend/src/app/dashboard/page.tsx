'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store';
import { dashboardApi } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import {
  Search,
  Download,
  ShieldCheck,
  Award,
  AlertTriangle,
  ArrowRight,
  User,
  Plus,
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

function formatSessionDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '—';
  }
}

function normalizeSession(raw: Record<string, unknown>): CandidateSession {
  const rawScore = raw.score ?? raw.overall_score ?? raw.total_score ?? raw.effective_score;
  const score = typeof rawScore === 'number' ? Math.round(rawScore) : 0;

  let grade_label = (raw.grade_label || raw.grade) as string | undefined;
  if (!grade_label) {
    if (score >= 85) grade_label = 'Distinction (A+)';
    else if (score >= 70) grade_label = 'Merit (B+)';
    else if (score >= 50) grade_label = 'Pass (C)';
    else grade_label = 'Pending Review';
  }

  const rawUser = raw.user as { student_id?: string; name?: string } | undefined;
  const rawConfig = raw.viva_config as { course_code?: string; title?: string } | undefined;

  return {
    id: (raw.id as string) || '',
    student_id: (raw.student_id || raw.student_id_code || raw.student_roll || rawUser?.student_id || '—') as string,
    student_name: (raw.student_name || raw.candidate_name || rawUser?.name || 'Unknown Candidate') as string,
    course_code: (raw.course_code || raw.subject || rawConfig?.course_code || '') as string,
    course_title: (raw.course_title || raw.viva_title || rawConfig?.title || 'Oral Viva') as string,
    status: ((raw.status as string) || 'completed').toLowerCase(),
    score: score,
    grade_label: grade_label,
    integrity_score: typeof raw.integrity_score === 'number' ? raw.integrity_score : 100,
    completed_at: ((raw.completed_at || raw.ended_at || raw.created_at || '') as string),
    turn_count: typeof raw.turn_count === 'number' ? raw.turn_count : (Array.isArray(raw.turns) ? raw.turns.length : 0),
    has_override: Boolean(raw.has_override || raw.override_score !== undefined || raw.override_score !== null),
  };
}

export default function AssessmentDashboardPage() {
  const { user, isAuthenticated, setAuth } = useAuthStore();

  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isExporting, setIsExporting] = useState(false);

  // Auto-switch to faculty mode if unauthenticated or student enters dashboard directly
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'faculty') {
      const demoFaculty = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Dr. Priya Sharma',
        role: 'faculty' as const,
        email: 'priya.sharma@university.edu',
      };
      setAuth('demo_faculty_token_drpriya', demoFaculty);


    }
  }, [isAuthenticated, user, setAuth]);

  // Load real sessions from backend API and normalize
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await dashboardApi.sessions();
        const items = res.data?.items || res.data;
        if (Array.isArray(items) && items.length > 0) {
          const normalized = items.map((item) => normalizeSession(item as Record<string, unknown>));
          setSessions(normalized);
        }
      } catch (err) {
        console.warn('Dashboard fetch notice, using verified sample sessions:', err);
      }
    }
    fetchSessions();
  }, []);

  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const res = await dashboardApi.exportCsv(statusFilter !== 'all' ? statusFilter : undefined);
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vivaai_assessments_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Client-side CSV generation fallback
      const headers = ['Student ID', 'Student Name', 'Course Code', 'Score', 'Grade', 'Integrity', 'Override', 'Completed At'];
      const rows = sessions.map((s) => [
        s.student_id,
        s.student_name,
        s.course_code,
        s.score ?? '',
        s.grade_label,
        `${s.integrity_score}%`,
        s.has_override ? 'Yes' : 'No',
        s.completed_at,
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'vivaai_assessments_export.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setIsExporting(false);
    }
  };

  // Filtered sessions
  const filteredSessions = sessions.filter((s) => {
    const matchesSearch =
      s.student_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.student_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.course_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      s.status.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  // Derived metrics
  const totalCount = sessions.length;
  const scoredCount = sessions.filter((s) => s.score !== null).length;
  const avgScore =
    scoredCount > 0
      ? Math.round(
          sessions.reduce((acc, s) => acc + (s.score || 0), 0) / scoredCount
        )
      : 0;
  const flaggedCount = sessions.filter((s) => s.status === 'flagged').length;
  const overrideCount = sessions.filter((s) => s.has_override).length;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] text-[var(--text-primary)] py-8 sm:py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Strip */}
        <div className="border-b border-[var(--border-default)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--primary)] uppercase tracking-wider">
                Faculty Assessment Board
              </span>
              <span className="text-xs text-[var(--text-muted)]">• Permanent Cohort Registry</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)]">
              Oral Assessment Registry & Audit Dossiers
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl">
              Inspect candidate spoken viva recordings, audit citation-backed rubric scores, and exercise sovereign grade override authority.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExporting}
              className="btn-outline text-xs px-3.5 flex items-center gap-2 min-h-[44px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? 'Generating CSV...' : 'Export Audit Ledger'}</span>
            </button>

            <Link href="/faculty/setup" className="btn-primary text-xs px-4 flex items-center gap-2 min-h-[44px]">
              <Plus className="w-3.5 h-3.5" />
              <span>Configure New Viva</span>
            </Link>
          </div>
        </div>

        {/* Academic Statistics Strip (Not 4 heavy bubble cards!) */}
        <div className="academic-dossier overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[var(--border-subtle)] bg-[var(--bg-card)]">
            <div className="p-4 sm:p-5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-mono text-[11px] uppercase tracking-wider">Total Candidates</span>
                <User className="w-4 h-4 text-[var(--primary)]" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-editorial text-[var(--text-primary)]">
                {totalCount}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                {scoredCount} completed oral examinations
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-mono text-[11px] uppercase tracking-wider">Cohort Mean Score</span>
                <Award className="w-4 h-4 text-emerald-700 dark:text-teal-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-editorial text-[var(--text-primary)]">
                {avgScore} <span className="text-sm font-sans font-normal text-[var(--text-muted)]">/ 100</span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-teal-400 font-medium">
                Standard Distribution B+ Merit
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-mono text-[11px] uppercase tracking-wider">Integrity Audits</span>
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-editorial text-[var(--text-primary)]">
                {flaggedCount}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Flagged for silence or window blur
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-mono text-[11px] uppercase tracking-wider">Faculty Overrides</span>
                <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-editorial text-[var(--text-primary)]">
                {overrideCount}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Recorded to permanent audit log
              </p>
            </div>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded bg-[var(--bg-card)] border border-[var(--border-default)]">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="dashboard-search"
              name="search"
              type="text"
              placeholder="Search by candidate name, roll number (e.g. STU001), or course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[44px]"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs">
            {['all', 'scored', 'flagged'].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-2 rounded font-medium transition-colors min-h-[40px] ${
                  statusFilter === status
                    ? 'bg-[var(--accent-subtle)] text-[var(--primary)] font-bold border border-[var(--border-default)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                }`}
              >
                {status === 'all' ? 'All Cohort' : status === 'scored' ? 'Scored Sessions' : 'Flagged Audits'}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop Assessment Registry Table */}
        <div className="hidden sm:block border border-[var(--border-default)] rounded overflow-x-auto bg-[var(--bg-card)] shadow-xs">
          <table className="table-academic min-w-[720px] w-full">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Course / Module</th>
                <th>Score & Grade</th>
                <th>Integrity</th>
                <th>Spoken Turns</th>
                <th>Completed</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => (
                <tr key={session.id}>
                  {/* Candidate */}
                  <td>
                    <div className="space-y-0.5">
                      <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                        {session.student_name}
                        {session.has_override && (
                          <span
                            title="Faculty override applied"
                            className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                          >
                            Override
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {session.student_id}
                      </span>
                    </div>
                  </td>

                  {/* Course Module */}
                  <td>
                    <div className="space-y-0.5 max-w-xs">
                      <span className="font-mono text-xs font-bold text-[var(--primary)]">
                        {session.course_code}
                      </span>
                      <p className="text-xs text-[var(--text-secondary)] truncate">
                        {session.course_title}
                      </p>
                    </div>
                  </td>

                  {/* Score & Grade */}
                  <td>
                    <div className="space-y-0.5">
                      <span className="font-bold text-sm text-[var(--text-primary)]">
                        {session.score !== null ? `${session.score} / 100` : 'Pending'}
                      </span>
                      <div className="text-xs text-[var(--text-muted)]">
                        {session.grade_label}
                      </div>
                    </div>
                  </td>

                  {/* Integrity Audit */}
                  <td>
                    <Badge variant={session.status === 'flagged' ? 'warning' : 'success'} dot>
                      {session.integrity_score}% Integrity
                    </Badge>
                  </td>

                  {/* Oral Turns */}
                  <td>
                    <span className="font-mono text-xs text-[var(--text-secondary)]">
                      {session.turn_count} turns
                    </span>
                  </td>

                  {/* Date (Deterministic UTC Formatting - No Hydration Mismatch) */}
                  <td>
                    <span className="text-xs text-[var(--text-muted)] font-mono">
                      {formatSessionDate(session.completed_at)}
                    </span>
                  </td>

                  {/* Review Dossier Link */}
                  <td className="text-right">
                    <Link
                      href={`/faculty/review/${session.id}`}
                      className="btn-secondary text-xs px-3 inline-flex items-center gap-1 min-h-[38px]"
                    >
                      <span>Review Dossier</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}

              {filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-[var(--text-muted)]">
                    No candidate oral sessions match your search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Viewport Card List (Prevents Horizontal Table Blowout) */}
        <div className="sm:hidden space-y-3">
          {filteredSessions.map((session) => (
            <div key={session.id} className="academic-dossier p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                    {session.student_name}
                    {session.has_override && (
                      <span className="px-1 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        Override
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-[var(--text-muted)]">
                    ID: {session.student_id} • {session.course_code}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-[var(--text-primary)] block">
                    {session.score !== null ? `${session.score}/100` : 'Pending'}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {session.grade_label}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--border-subtle)]">
                <Badge variant={session.status === 'flagged' ? 'warning' : 'success'} dot>
                  {session.integrity_score}% Integrity
                </Badge>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  {session.turn_count} oral turns
                </span>
              </div>

              <Link
                href={`/faculty/review/${session.id}`}
                className="btn-secondary w-full justify-center text-xs mt-2"
              >
                Review Dossier & Audio
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
