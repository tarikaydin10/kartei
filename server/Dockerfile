# Kartei-Sync-Server. Kein Build, keine Pakete: Node führt TypeScript direkt aus,
# SQLite ist eingebaut. Bauen aus diesem Verzeichnis:
#
#   docker build -t kartei-sync server/
FROM node:24-alpine

WORKDIR /app
COPY store.ts app.ts main.ts ./

RUN mkdir -p /data && chown node:node /data
USER node

ENV PORT=8788 \
    SYNC_DB=/data/kartei-sync.db \
    NODE_NO_WARNINGS=1

EXPOSE 8788
VOLUME /data

HEALTHCHECK --interval=60s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8788/api/sync/health || exit 1

CMD ["node", "main.ts"]
