# Production Dockerfile for VivaAI Faculty Assessment Portal (Port 3001)
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/faculty-web/package.json ./apps/faculty-web/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --workspace=@vivaai/faculty-web --workspace=@vivaai/shared || npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_STUDENT_URL
ARG NEXT_PUBLIC_FACULTY_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_STUDENT_URL=$NEXT_PUBLIC_STUDENT_URL
ENV NEXT_PUBLIC_FACULTY_URL=$NEXT_PUBLIC_FACULTY_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm --workspace=@vivaai/faculty-web run build

# Production runner image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/faculty-web/public ./apps/faculty-web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/faculty-web/.next ./apps/faculty-web/.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/faculty-web/package.json ./apps/faculty-web/package.json
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3001

CMD ["npx", "--workspace=@vivaai/faculty-web", "next", "start", "-p", "3001"]
