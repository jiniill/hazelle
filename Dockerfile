# syntax=docker/dockerfile:1
# Build: on the builder's own platform. Everything it emits is JavaScript, so the arm64 image needs no emulation, and
# the runtime stage below runs no command for the same reason.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
ENV NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# release/source.tar.gz is the release commit's archive (scripts/source.sh, run by .github/workflows/release.yml before
# this build). The context holds no .git, so a build without it serves no /source.tar.gz and says so here.
# HAZELLE_VERSION: the release tag (.github/workflows/release.yml), in the server bundle, which writes it on the page.
# Not given to Vite: the chunks stay the same across a release that leaves the page as it was, so tabs keep working and
# nothing offers them a reload. A build without one compares nothing. It lives in the bundle, not in the runtime
# environment, so the app the release copies out of /app for the start without Docker has it.
ARG HAZELLE_VERSION=
RUN ./node_modules/.bin/vite build \
 && npm run -s build:server -- "--define:process.env.HAZELLE_VERSION=\"$HAZELLE_VERSION\"" \
 && cp LICENSE dist/client/license.txt \
 && if [ -f release/source.tar.gz ]; then cp release/source.tar.gz dist/client/; else echo 'hazelle: source archive absent, /source.tar.gz will answer 404' >&2; fi \
 && mkdir -p /out/node_modules /out/data \
 # undici is the bundle's only external (build:server --external); it has no dependencies of its own.
 && cp -r node_modules/undici /out/node_modules/

FROM node:24-alpine
ENV NODE_ENV=production HAZELLE_DATA=/data PORT=8080 HAZELLE_CONTAINER=1
# node.ts finds dist/client relative to the working directory and migrations/ two levels above dist/server.
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /out/node_modules node_modules
COPY --from=build /src/migrations migrations
COPY --from=build /src/scripts/restore.sh scripts/restore.sh
COPY --from=build /src/dist dist
COPY --from=build --chown=node:node /out/data /data
USER node
VOLUME /data
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/server/node.js"]
