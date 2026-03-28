# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server (Express + Vite middleware) on port 3000
npm run build     # Build frontend with Vite → dist/
npm start         # Production mode (serves dist/ via Express)
npm run lint      # TypeScript type-check only (tsc --noEmit), no test runner configured
npm run preview   # Preview Vite production build
```

## Environment

Copy `.env.example` to `.env.local` and set:
- `JWT_SECRET` — secret for signing JWT tokens
- `GEMINI_API_KEY` — Google Generative AI key (also accepted as `API_KEY` or `VITE_GEMINI_API_KEY`)
- `PORT` — defaults to 3000

## Architecture

**Full-stack single-file-ish app** for Umrah pilgrimage travel logistics. The backend and frontend live in the same repo; `server.ts` runs both in dev mode via Vite middleware.

### Backend (`server.ts`)
- Express + SQLite (`umrah.db`, WAL mode via `better-sqlite3`)
- JWT auth with bcrypt password hashing
- Three tables: `users`, `logistics_rows`, `settings`
- In dev: serves Vite dev middleware. In production: serves `dist/` static files.
- Auth middleware protects all `/api/data` and `/api/settings` routes; tokens go in `Authorization: Bearer <token>` header.

### Frontend
- React 19 + TypeScript, bundled by Vite
- **No global state library** — all state lives in `App.tsx` via hooks, passed down as props
- `services/api.ts` — centralized HTTP client; reads JWT from `localStorage`, auto-calls `onLogout` on 401
- `App.tsx` — main orchestrator: handles auth state, data fetching, sync logic, proximity alert scheduling, settings persistence

### Key Components
- `components/Auth.tsx` — login/register form
- `components/TableEditor.tsx` — main data grid with filtering, sorting, inline editing
- `components/LogisticsBot.tsx` — Google Gemini AI chatbot for logistics queries
- `components/OperationsIntelligence.tsx` — KPI analytics dashboard
- `utils/parser.ts` — date/text parsing for trip data

### Data Model
`types.ts` defines all shared types. Core type is `LogisticsRow` (group, date, flight, route, status, etc.). `TripStatus` is a string enum: `'Planned' | 'Confirmed' | 'Driver Assigned' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled'`.

Settings (stored per-user in SQLite) include: Telegram bot config, saved templates, deleted rows (soft-delete trash), and notified row IDs for proximity alerts.

### AI Integration
`LogisticsBot` uses `@google/genai`. The API key is injected at build time via `vite.config.ts` (`process.env.API_KEY` → `VITE_GEMINI_API_KEY` fallback chain).
