# SyncedDB file backend (Bun)
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || true

COPY . .

# Persistence: mount host volume at /mnt (see docker-compose)
ENV STORAGE_PATH=/mnt
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "index.ts"]
