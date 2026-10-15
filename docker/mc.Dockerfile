FROM golang:1.24.8-alpine3.22 AS build

ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096

RUN apk add --no-cache ca-certificates git
WORKDIR /src
RUN git init && \
    git remote add origin https://github.com/minio/mc.git && \
    git fetch --depth 1 origin "refs/tags/${MC_RELEASE}" && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "${MC_COMMIT}"
RUN mkdir /out && \
    LDFLAGS="$(MC_RELEASE=RELEASE go run buildscripts/gen-ldflags.go)" && \
    CGO_ENABLED=0 go build -trimpath --ldflags "${LDFLAGS}" -o /out/mc

FROM alpine:3.22

RUN apk add --no-cache ca-certificates
COPY --from=build /out/mc /usr/bin/mc

ENTRYPOINT ["/usr/bin/mc"]
