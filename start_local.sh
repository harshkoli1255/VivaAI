#!/usr/bin/env bash
# ============================================================
# VivaAI — Local Development Multi-Application Startup Script
# Starts:
#   1. FastAPI Backend                -> http://localhost:8000
#   2. Student Examination Web Portal -> http://localhost:3000
#   3. Faculty Assessment Web Portal  -> http://localhost:3001
# ============================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export no_proxy="localhost,127.0.0.1,0.0.0.0"
export NO_PROXY="localhost,127.0.0.1,0.0.0.0"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VivaAI — Standardized Oral Technical Viva Platform"
echo "  Multi-Portal Architecture (Student + Faculty + API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Preserve other processes, including an already running examination.
for service_port in 8000 3000 3001; do
    if lsof -tiTCP:"$service_port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Port $service_port is already in use. Stop the existing service before starting VivaAI."
        exit 1
    fi
done
BACKEND_PID=""
STUDENT_PID=""
FACULTY_PID=""
cleanup() {
    local previous_status=$?
    trap - EXIT
    for service_pid in "$BACKEND_PID" "$STUDENT_PID" "$FACULTY_PID"; do
        if [ -n "$service_pid" ]; then kill "$service_pid" 2>/dev/null || true; fi
    done
    exit "$previous_status"
}
trap cleanup EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

# Determine Python binary (.venv preferred)
if [ -f "$PROJECT_ROOT/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"
elif [ -f "$PROJECT_ROOT/backend/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_ROOT/backend/.venv/bin/python"
else
    PYTHON_BIN="python3"
fi

# 1. Start FastAPI Backend (Port 8000)
echo "[1/3] Starting FastAPI backend on http://localhost:8000..."
cd "$PROJECT_ROOT/backend"
"$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait for backend to be healthy
echo "Waiting for backend health check..."
backend_ready=false
for i in {1..20}; do
    if /usr/bin/curl -s --noproxy "*" http://127.0.0.1:8000/health >/dev/null 2>&1; then
        echo "✓ Backend is healthy at http://localhost:8000 (API Docs: http://localhost:8000/api/docs)"
        backend_ready=true
        break
    fi
    sleep 0.5
done
if [ "$backend_ready" != true ]; then
    echo "Backend did not become healthy. Check the startup error above."
    exit 1
fi

# 2. Start Student Web Portal (Port 3000)
echo "[2/3] Starting Student Web Portal on http://localhost:3000..."
cd "$PROJECT_ROOT/apps/student-web"
NEXT_BUILD_DIR=.next-local ../../node_modules/.bin/next dev --webpack -p 3000 --hostname 127.0.0.1 &
STUDENT_PID=$!

# 3. Start Faculty Assessment Portal (Port 3001)
echo "[3/3] Starting Faculty Assessment Portal on http://localhost:3001..."
cd "$PROJECT_ROOT/apps/faculty-web"
NEXT_BUILD_DIR=.next-local ../../node_modules/.bin/next dev --webpack -p 3001 --hostname 127.0.0.1 &
FACULTY_PID=$!

# Listening ports alone do not establish that a portal can call the backend.
for portal_port in 3000 3001; do
    portal_ready=false
    for i in {1..40}; do
        response_status=$(/usr/bin/curl -s --noproxy "*" --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$portal_port/api/v1/auth/me" || true)
        if [ "$response_status" = 401 ]; then portal_ready=true; break; fi
        sleep 0.5
    done
    if [ "$portal_ready" != true ]; then
        echo "Portal $portal_port cannot reach the backend. Check server connection settings and terminal network permissions."
        exit 1
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VivaAI Multi-App Services Active & Ready!"
echo "  - Student Exam Portal:       http://localhost:3000"
echo "    Cloudflare Tunnel:         https://milton-robot-perl-lib.trycloudflare.com"
echo "  - Faculty Assessment Portal: http://localhost:3001"
echo "    Cloudflare Tunnel:         https://foundation-katie-building-bedford.trycloudflare.com"
echo "  - Shared Backend API & WS:   http://localhost:8000"
echo "    Cloudflare Tunnel:         https://signed-commerce-newcastle-proprietary.trycloudflare.com"
echo "  - Interactive Swagger Docs:  http://localhost:8000/docs"
echo ""
echo "  Testing & Dummy User Personas:"
echo "  - Student Examination Portal (http://localhost:3000):"
echo "      * University ID: STU001 (or 'student' / 'student@vivaai.edu')"
echo "      * Password:      student123"
echo "  - Faculty Assessment Portal (http://localhost:3001):"
echo "      * Email:         priya.sharma@university.edu (or 'faculty@vivaai.edu')"
echo "      * Password:      faculty123"
echo "      * Admin Faculty: harshkoli@university.edu / harshkoli1582"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop all services."

# Keep script running
wait
