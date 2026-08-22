FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build:client

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=build /app/src/public/js/editor-bundle.js ./src/public/js/editor-bundle.js

RUN useradd --system --create-home --shell /usr/sbin/nologin vellum \
    && mkdir -p /app/data \
    && chown -R vellum:vellum /app \
    && chmod +x deploy/docker-entrypoint.sh

USER vellum

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/vellum.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/login', (res) => process.exit(res.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["./deploy/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
