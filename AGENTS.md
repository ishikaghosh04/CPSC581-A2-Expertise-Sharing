# AGENTS.md

## Project

CPSC 581 A2 — CAD lighting expertise-sharing prototype. See `Plan.md` for the
design, session flow, and build order.

## Stack

TypeScript monorepo managed by **npm workspaces** (no Nx/Turbo):

- `packages/shared` — wire protocol types (CameraState, LightState, message maps). Consumed as TypeScript source (`exports` → `src/index.ts`) by both apps; no build step.
- `apps/server` — Node + Express + Socket.IO, in-memory session store, no DB. Source is TypeScript; run with `tsx` (no separate compile).
- `apps/web` — Vite + vanilla TypeScript + Three.js. Dev server proxies `/socket.io` to the backend.

## Commands

Run these from the repo root:

- `npm run dev` — both server (port 3000) and web dev server together.
- `npm run dev:server` / `npm run dev:web` — individually.
- `npm run typecheck` — `tsc --noEmit` in every workspace.
- `npm run build` — production build of the web app to `apps/web/dist` (served by the Express server when present).
- `node scripts/smoke.mjs` — E2E protocol smoke test; start the server first (`PORT=3901 npm start --workspace apps/server`, then run the script — it targets `SMOKE_URL` or localhost:3901).

## Conventions

- Strict TypeScript (`tsconfig.base.json`), no `any` in app code.
- Any Socket.IO message change goes in `packages/shared/src/index.ts` first.
- Session state lives only in memory; there is no database and none is planned for v1.
- Commit `.gitignore`d things only.
