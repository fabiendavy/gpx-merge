# --- Stage 1: Build backend & frontend ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm install --workspace backend --workspace frontend

COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN npm run build --workspace backend
RUN npm run build --workspace frontend

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN npm install --workspace backend --omit=dev

EXPOSE 3000

CMD ["node", "backend/dist/server.js"]
