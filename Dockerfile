# Long-running Lumina server. Tectonic is installed in the image.
# API keys are not baked in; Settings (or optional runtime env) supplies them.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=43123
ENV LUMINA_DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 lumina \
  && useradd --uid 1001 --gid lumina --home-dir /app --shell /usr/sbin/nologin lumina

COPY --from=builder --chown=lumina:lumina /app/.next/standalone ./
COPY --from=builder --chown=lumina:lumina /app/.next/static ./.next/static
COPY --from=builder --chown=lumina:lumina /app/sample-project ./sample-project
COPY --from=builder --chown=lumina:lumina /app/sample-cv ./sample-cv
COPY --from=builder --chown=lumina:lumina /app/scripts/setup-tectonic.sh ./scripts/setup-tectonic.sh
COPY --from=builder --chown=lumina:lumina /app/scripts/start-standalone.sh ./scripts/start-standalone.sh

RUN mkdir -p /data /app/tools /app/scripts \
  && chown -R lumina:lumina /app /data

USER lumina
RUN bash scripts/setup-tectonic.sh

EXPOSE 43123
VOLUME ["/data"]
CMD ["sh", "scripts/start-standalone.sh"]
