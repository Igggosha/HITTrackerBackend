FROM golang:1.24.8-alpine3.22 AS build

ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a

RUN apk add --no-cache bash ca-certificates git
WORKDIR /src
RUN git init && \
    git remote add origin https://github.com/minio/minio.git && \
    git fetch --depth 1 origin "refs/tags/${MINIO_RELEASE}" && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "${MINIO_COMMIT}"
RUN mkdir /out && \
    LDFLAGS="$(go run buildscripts/gen-ldflags.go)" && \
    CGO_ENABLED=0 go build -tags kqueue -trimpath \
      --ldflags "${LDFLAGS}" -o /out/minio

FROM alpine:3.22

RUN apk add --no-cache ca-certificates && \
    addgroup -S -g 1000 minio && \
    adduser -S -D -H -u 1000 -G minio minio && \
    mkdir -p /data && \
    chown minio:minio /data
COPY --from=build /out/minio /usr/bin/minio

USER minio
VOLUME ["/data"]
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
