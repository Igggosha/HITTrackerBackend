#!/bin/sh
# Provisions the object storage bucket used for user-uploaded media.
#
# The bucket is deliberately private: clients never read it directly, they
# follow short-lived presigned URLs issued by the API. The API authenticates
# with a bucket-scoped service account rather than the MinIO root credentials.
set -eu

ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
BUCKET="${S3_BUCKET:-hit-tracker}"
UPLOAD_PREFIX="${S3_UPLOAD_PREFIX:-uploads}"
TEMP_PREFIX="${S3_TEMP_PREFIX:-tmp}"
TEMP_EXPIRY_DAYS="${S3_TEMP_EXPIRY_DAYS:-1}"
POLICY_NAME="${BUCKET}-readwrite"

if [ -z "${MINIO_ROOT_USER:-}" ] || [ -z "${MINIO_ROOT_PASSWORD:-}" ]; then
  echo "minio-init: MINIO_ROOT_USER and MINIO_ROOT_PASSWORD are required." >&2
  exit 1
fi

echo "minio-init: waiting for ${ENDPOINT}"
mc alias set local "$ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc ready local

echo "minio-init: ensuring bucket ${BUCKET}"
mc mb --ignore-existing "local/${BUCKET}" >/dev/null
# Reads go through presigned URLs, so anonymous access must stay off.
mc anonymous set none "local/${BUCKET}" >/dev/null

# Scratch objects must not accumulate forever. MinIO cleans unfinished
# multipart uploads through its server-side stale-upload sweep; unlike AWS S3,
# it does not persist AbortIncompleteMultipartUpload lifecycle rules.
cat >/tmp/lifecycle.json <<JSON
{
  "Rules": [
    {
      "ID": "expire-temporary-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "${TEMP_PREFIX}/" },
      "Expiration": { "Days": ${TEMP_EXPIRY_DAYS} }
    }
  ]
}
JSON
mc ilm rule import "local/${BUCKET}" </tmp/lifecycle.json >/dev/null

if [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "minio-init: S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are unset;" >&2
  echo "minio-init: the API would have to use root credentials. Refusing." >&2
  exit 1
fi

if [ "$S3_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ]; then
  echo "minio-init: S3_ACCESS_KEY_ID must differ from MINIO_ROOT_USER." >&2
  exit 1
fi

echo "minio-init: ensuring bucket-scoped policy ${POLICY_NAME}"
cat >/tmp/policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::${BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::${BUCKET}/${UPLOAD_PREFIX}/*",
        "arn:aws:s3:::${BUCKET}/${TEMP_PREFIX}/*"
      ]
    }
  ]
}
JSON
mc admin policy create local "$POLICY_NAME" /tmp/policy.json >/dev/null

echo "minio-init: ensuring service account ${S3_ACCESS_KEY_ID}"
# `user add` is idempotent for an existing key: it resets the secret to the
# configured one, which keeps .env the single source of truth.
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
if ! mc admin policy attach local "$POLICY_NAME" --user "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  # `attach` exits 1 when the exact mapping already exists. Accept only that
  # no-op case; any real failure also makes this read-back check fail.
  mc --json admin policy entities local --user "$S3_ACCESS_KEY_ID" \
    | grep -F "$POLICY_NAME" >/dev/null
fi
mc admin user enable local "$S3_ACCESS_KEY_ID" >/dev/null

rm -f /tmp/policy.json /tmp/lifecycle.json
echo "minio-init: bucket ${BUCKET} is ready."
