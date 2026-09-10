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
ENV NODE_ENV=production
COPY package*.json ./
COPY extension/package.json extension/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY songstats/package.json songstats/package.json
RUN npm ci --omit=dev --workspace @ct-details-updater/songstats --workspace @ct-details-updater/shared
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/songstats/dist songstats/dist
USER node
EXPOSE 5175
CMD ["node", "songstats/dist/server/index.js"]
