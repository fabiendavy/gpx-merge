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

```bash
docker build -t gpx-merge .
docker run -p 3000:3000 gpx-merge
```

Or with docker-compose:

```bash
docker compose up
```

## How it works

1. Upload multiple `.gpx` files via the UI (drag & drop or file picker).
2. The backend parses all track points, **sorts them by `<time>` timestamp**.
3. Points without a `<time>` element are **ignored**.
4. A single merged GPX file is returned for download.

## API

### `POST /api/merge`

- **Body**: `multipart/form-data` with a `files` field (array of `.gpx` files, min 2)
- **Response**: `application/gpx+xml` file download (`merged.gpx`)
- **Header `X-Merge-Stats`**: JSON with `{ totalFiles, totalPoints, mergedPoints, ignoredPoints }`

### `GET /api/health`

Returns `{ status: "ok" }`.
