FROM node:22.21.1-bookworm-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS build

ENV CI=true
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile && \
    pnpm --filter @blog-studio/studio... build && \
    pnpm --filter @blog-studio/studio deploy --prod --legacy /opt/blog-studio

FROM node:22.21.1-bookworm-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/DjangoAILab/blog-studio" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    BLOG_STUDIO_HOST=0.0.0.0 \
    BLOG_STUDIO_PORT=4310 \
    BLOG_STUDIO_CLIENT_DIRECTORY=/app/dist/client

RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app /data /workspaces && \
    chown -R node:node /app /data /workspaces

COPY --from=build --chown=node:node /opt/blog-studio/ /app/
COPY --from=build --chown=node:node /source/scripts/ /opt/blog-studio/scripts/

WORKDIR /app
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/main.js"]
