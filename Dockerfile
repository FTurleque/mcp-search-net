# Node.js 24.18.0 / bookworm-slim, pinned exclusively by immutable digest.
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Same qualified Node.js 24.18.0 base, pinned exclusively by immutable digest.
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
ARG SOURCE_REVISION=UNAVAILABLE
LABEL org.opencontainers.image.title="mcp-search-net" \
      org.opencontainers.image.description="Local read-only MCP Web search and documentation catalog server" \
      org.opencontainers.image.version="1.1.3" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="LicenseRef-mcp-search-net-Proprietary"
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json LICENSE ./
COPY .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY config/application.docker.yml config/official-sources.yml ./config/
COPY migrations ./migrations
COPY catalog-migrations ./catalog-migrations
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
ENV MCP_CONFIG_PATH=/app/config/application.docker.yml
ENTRYPOINT ["node", "build/bootstrap/main.js"]
