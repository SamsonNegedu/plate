# syntax=docker/dockerfile:1
# The build stages run on the build machine's own architecture and cross-compile; only the last stage is per-target,
# so an arm64 image is built without emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/
RUN cd web && pnpm install --frozen-lockfile
COPY web web
RUN mkdir -p internal/webui && cd web && pnpm build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS go
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
# Compile the third-party tree (mostly SQLite) in its own layer, keyed on go.mod and go.sum, so a code-only change
# reuses it. Same flags as the real build, or the cache would not match. A dependency missing here only costs time.
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
    github.com/alexedwards/argon2id github.com/alexedwards/scs/v2 github.com/danielgtaylor/huma/v2 \
    github.com/danielgtaylor/huma/v2/adapters/humachi github.com/go-chi/chi/v5 github.com/google/uuid \
    github.com/pressly/goose/v3 modernc.org/sqlite
COPY . .
COPY --from=web /src/internal/webui/dist internal/webui/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/plate ./cmd/plate
# The runtime user (65532) must own the empty data dir so a fresh named volume inherits it.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

# No RUN here, so the arm64 image needs no emulation. Alpine carries the CA bundle; uid 65532 needs no passwd entry.
FROM alpine:3.22
COPY --from=go /out/plate /plate
COPY --from=go --chown=65532:65532 /out/data /data
COPY --from=go /src/data/off-catalog.db /seed/off-catalog.db
ENV PLATE_ADDR=:8080 PLATE_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/plate"]
