FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.17.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY config ./config
COPY migrations ./migrations
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
ENV MCP_CONFIG_PATH=/app/config/application.docker.yml
ENTRYPOINT ["node", "build/bootstrap/main.js"]
