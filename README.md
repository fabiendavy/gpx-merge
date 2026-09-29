# GPX Merge

Merge multiple GPX files into a single activity, sorted by timestamp.

## Run locally (dev)

```bash
npm install
npm run dev
```

Open **http://localhost:3000** — the backend proxies the frontend to Vite, so file changes reload automatically (frontend HMR + backend restart on save).

You can also open http://localhost:5173 directly (Vite dev server; `/api` is proxied to the backend).

## Build

```bash
npm run build
npm start
```

Server serves both API and frontend on http://localhost:3000.

## Docker

`docker compose up` is the **production** image. Source is copied at build time, so editing files on your machine will not change what you see in the browser until you rebuild:

```bash
docker compose up --build
```

### Live reload with Docker Compose

Use the dev compose file. It runs `tsx watch` + Vite and bind-mounts source, so a refresh (or HMR) picks up edits:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Then open **http://localhost:3000**.

- Frontend (`frontend/src`, `index.html`, CSS): Vite serves the latest files. Refresh or wait for HMR.
- Backend (`backend/src`): `tsx watch` restarts the server. Wait a second, then refresh.

Stop the production stack first if port 3000 is already taken (`docker compose down`).

## How it works

1. Upload multiple `.gpx` files via the UI (drag & drop or file picker).
2. The backend parses all track points, **sorts them by `<time>` timestamp**.
3. Points without a `<time>` element are **ignored**.
4. A single merged GPX file is returned for download.

## API

### `POST /api/merge`

- **Body**: `multipart/form-data` with a `files` field (array of `.gpx` files, min 2, max 20)
- **Limits**: 50 MB per file, 150 MB total
- **Response**: `application/gpx+xml` file download (`merged.gpx`)
- **Header `X-Merge-Stats`**: JSON with `{ totalFiles, totalPoints, mergedPoints, ignoredPoints }`

### `GET /api/health`

Returns `{ status: "ok" }`.
