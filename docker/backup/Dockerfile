ARG MC_IMAGE=quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z
FROM ${MC_IMAGE} AS mc

FROM postgres:17.6-alpine
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
ENTRYPOINT ["/bin/sh", "/scripts/entrypoint.sh"]
CMD ["schedule"]
