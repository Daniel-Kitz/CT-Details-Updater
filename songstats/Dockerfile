FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY extension/package.json extension/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY songstats/package.json songstats/package.json
RUN npm ci
COPY shared shared
COPY songstats songstats
RUN npm run build -w @ct-details-updater/shared && npm run build -w @ct-details-updater/songstats

FROM node:22-alpine
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/Daniel-Kitz/CT-Details-Updater"
LABEL org.opencontainers.image.description="Self-hosted ChurchTools song usage statistics"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5175 \
    MONTHLY_CACHE_FILE=/data/songstats-cache.json
COPY package*.json ./
COPY extension/package.json extension/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY songstats/package.json songstats/package.json
RUN npm ci --omit=dev --workspace @ct-details-updater/songstats --workspace @ct-details-updater/shared
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/songstats/dist songstats/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5175
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5175/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "songstats/dist/server/index.js"]
