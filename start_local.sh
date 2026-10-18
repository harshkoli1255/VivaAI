#!/usr/bin/env bash
# ============================================================
# VivaAI — Local Development Startup Script
# Starts both FastAPI Backend (port 8000) and Next.js (port 3000)
# ============================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VivaAI — Standardized Oral Technical Viva Platform"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Clean up existing processes on port 8000 and 3000
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

# Function to shut down background processes on exit
cleanup() {
    echo ""
    echo "Shutting down VivaAI services..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start FastAPI Backend
echo "[1/2] Starting FastAPI backend on http://localhost:8000..."
cd "$PROJECT_ROOT/backend"
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be healthy
echo "Waiting for backend health check..."
for i in {1..20}; do
    if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
        echo "✓ Backend is healthy at http://localhost:8000 (API Docs: http://localhost:8000/docs)"
        break
    fi
    sleep 0.5
done

# 2. Start Next.js Frontend
echo "[2/2] Starting Next.js frontend on http://localhost:3000..."
cd "$PROJECT_ROOT/frontend"
npx next dev -p 3000 --hostname 127.0.0.1 &
FRONTEND_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  VivaAI is now live and ready!"
echo "  - Candidate & Faculty Web App: http://localhost:3000"
echo "  - Backend API & WS:            http://localhost:8000"
echo "  - Interactive Swagger Docs:    http://localhost:8000/docs"
echo ""
echo "  Seed Demo Credentials:"
echo "  - Faculty: priya.sharma@university.edu / faculty123"
echo "  - Student: Student ID STU001 / student123"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop all services."

# Keep script running
wait
