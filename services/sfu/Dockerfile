# syntax=docker/dockerfile:1

# Raven SFU — the media plane.
#
# Two things about this image are unusual for a service in this repo, and
# both follow from it carrying media rather than requests:
#
#  1. It needs a large, contiguous UDP port range published on the host.
#     Media does not go through the API's ingress, so there is nothing to
#     reverse-proxy it — ICE hands clients a host:port and they connect to
#     it directly.
#  2. It is stateful for the lifetime of a call. Rooms live in this
#     process, so a restart drops the calls on it. That is why deploys
#     drain a node (see docs/rtc/scaling.md) instead of rolling it.

# --platform=$BUILDPLATFORM pins the build stage to the *builder's* native
# architecture and lets Go cross-compile to the target below. Without it,
# buildx would emulate the whole toolchain under QEMU for every non-native
# platform — minutes per architecture instead of seconds, for a compiler
# that already cross-compiles natively. CGO is off, so there is no C
# toolchain to cross for.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build

WORKDIR /src

# Dependencies first, so a code-only change does not re-download the
# module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Supplied by buildx, one value per --platform entry. Defaulted so a plain
# `docker build` outside buildx still works.
ARG TARGETOS=linux
ARG TARGETARCH=amd64

# CGO off for a static binary that runs on a distroless/alpine base.
# Trimpath and stripped symbols keep the image small; the SFU is debugged
# through its logs and Prometheus endpoint, not a core dump.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/sfu \
      ./cmd/sfu

FROM alpine:3.24

# ca-certificates so the registry client can reach a control plane over
# HTTPS. Nothing else is needed — the binary is static.
RUN apk add --no-cache ca-certificates \
    && adduser -D -u 10001 raven

COPY --from=build /out/sfu /usr/local/bin/sfu

# The node reports its version through config (SFU_VERSION, defaulting to
# "dev") rather than a linker-injected symbol, so the build arg is baked in
# as an env var here. That way the registry row and /healthz report the
# image tag that is actually running, and an operator reading the fleet
# list can tell two nodes apart. Overridable at run time like any other
# setting.
ARG VERSION=dev
ENV SFU_VERSION=${VERSION}

USER raven

# Control plane only. Media arrives on the UDP range below, which is set
# by SFU_UDP_PORT_MIN/MAX and must be published by whatever runs this.
EXPOSE 7000/tcp

# Documented rather than enforced: the actual range comes from config, and
# EXPOSE cannot take a variable. Keep this in step with the compose file
# and the k8s manifests.
EXPOSE 50000-50200/udp

ENTRYPOINT ["/usr/local/bin/sfu"]
