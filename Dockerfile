FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532 AS runtime
ARG SOURCE_REVISION=UNAVAILABLE
LABEL org.opencontainers.image.title="mcp-search-net" \
      org.opencontainers.image.description="Local read-only MCP Web search and documentation catalog server" \
      org.opencontainers.image.version="1.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="LicenseRef-mcp-search-net-Proprietary"
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json LICENSE ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY config/application.docker.yml config/official-sources.yml ./config/
COPY migrations ./migrations
COPY catalog-migrations ./catalog-migrations
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
ENV MCP_CONFIG_PATH=/app/config/application.docker.yml
ENTRYPOINT ["node", "build/bootstrap/main.js"]
