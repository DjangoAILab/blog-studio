FROM node:22.21.1-alpine3.23@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf AS build

ENV CI=true
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY scripts/ ./scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile && \
    pnpm --filter @blog-studio/studio... build && \
    pnpm --filter @blog-studio/studio deploy --prod --legacy /opt/blog-studio

FROM node:22.21.1-alpine3.23@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf AS runtime

ENV NODE_ENV=production \
    BLOG_STUDIO_HOST=0.0.0.0 \
    BLOG_STUDIO_PORT=4310 \
    BLOG_STUDIO_CLIENT_DIRECTORY=/app/dist/client

RUN apk upgrade --no-cache libcrypto3 libssl3 && \
    apk add --no-cache git && \
    rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx && \
    mkdir -p /app /data /workspaces && \
    chown -R node:node /app /data /workspaces

COPY --from=build --chown=node:node /opt/blog-studio/ /app/
COPY --from=build --chown=node:node /source/scripts/ /opt/blog-studio/scripts/

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/DjangoAILab/blog-studio" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/main.js"]
