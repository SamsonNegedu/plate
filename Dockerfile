# syntax=docker/dockerfile:1
FROM node:24-alpine AS web
WORKDIR /src
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/
RUN cd web && pnpm install --frozen-lockfile
COPY web web
RUN mkdir -p internal/webui && cd web && pnpm build

FROM golang:1.27-alpine AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/webui/dist internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/plate ./cmd/plate
# The distroless user must own the empty data dir so a fresh named volume inherits it.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /out/plate /plate
COPY --from=go --chown=65532:65532 /out/data /data
COPY --from=go /src/data/off-catalog.db /seed/off-catalog.db
ENV PLATE_ADDR=:8080 PLATE_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/plate"]
