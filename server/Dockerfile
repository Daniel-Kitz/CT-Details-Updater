FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY extension/package.json extension/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci
COPY shared shared
COPY server server
RUN npm run build -w @ct-details-updater/shared && npm run build -w @ct-details-updater/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY extension/package.json extension/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --omit=dev --workspace @ct-details-updater/server --workspace @ct-details-updater/shared
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/shared/dist shared/dist
USER node
CMD ["node", "server/dist/index.js"]
