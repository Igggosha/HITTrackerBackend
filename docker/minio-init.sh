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
BACKUP_POLICY_NAME="${BUCKET}-backup-readonly"
RESTORE_POLICY_NAME="${BUCKET}-restore-readwrite"

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
rm -f /tmp/lifecycle.json

# Creates (or refreshes the secret/policy of) one scoped service account.
# `user add` is idempotent for an existing key: it resets the secret to the
# configured one, which keeps .env the single source of truth. `policy attach`
# exits 1 when the exact mapping already exists; that no-op case is accepted
# by reading the mapping back, so any real failure still fails the script.
ensure_account() {
  label=$1
  key_id=$2
  secret=$3
  policy_name=$4
  policy_file=$5

  if [ "$key_id" = "$MINIO_ROOT_USER" ]; then
    echo "minio-init: ${label} access key must differ from MINIO_ROOT_USER." >&2
    exit 1
  fi

  echo "minio-init: ensuring ${label} policy ${policy_name}"
  mc admin policy create local "$policy_name" "$policy_file" >/dev/null

  echo "minio-init: ensuring ${label} account ${key_id}"
  mc admin user add local "$key_id" "$secret" >/dev/null
  if ! mc admin policy attach local "$policy_name" --user "$key_id" >/dev/null 2>&1; then
    mc --json admin policy entities local --user "$key_id" \
      | grep -F "$policy_name" >/dev/null
  fi
  mc admin user enable local "$key_id" >/dev/null
}

if [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "minio-init: S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are unset;" >&2
  echo "minio-init: the API would have to use root credentials. Refusing." >&2
  exit 1
fi

cat >/tmp/api-policy.json <<JSON
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
ensure_account "API" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" "$POLICY_NAME" /tmp/api-policy.json
rm -f /tmp/api-policy.json

# The scheduled backup service only ever reads the bucket to mirror it, so it
# gets a read-only account instead of MinIO root. Optional: the backup
# profile is opt-in, so this account is skipped (not required) when unset.
if [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ] && [ -n "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
  cat >/tmp/backup-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${BUCKET}/*"]
    }
  ]
}
JSON
  ensure_account "backup (read-only)" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" \
    "$BACKUP_POLICY_NAME" /tmp/backup-policy.json
  rm -f /tmp/backup-policy.json
else
  echo "minio-init: BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY unset; skipping backup account." >&2
fi

# Restoring writes objects across the whole bucket (not just uploads/tmp), so
# it needs a broader, still-scoped, write-capable account. This is meant to
# be supplied only when a human runs `restore`, never stored in the always-on
# backup service's environment. Optional: skipped when unset.
if [ -n "${RESTORE_S3_ACCESS_KEY_ID:-}" ] && [ -n "${RESTORE_S3_SECRET_ACCESS_KEY:-}" ]; then
  cat >/tmp/restore-policy.json <<JSON
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
      "Resource": ["arn:aws:s3:::${BUCKET}/*"]
    }
  ]
}
JSON
  ensure_account "restore (read-write)" "$RESTORE_S3_ACCESS_KEY_ID" "$RESTORE_S3_SECRET_ACCESS_KEY" \
    "$RESTORE_POLICY_NAME" /tmp/restore-policy.json
  rm -f /tmp/restore-policy.json
else
  echo "minio-init: RESTORE_S3_ACCESS_KEY_ID/RESTORE_S3_SECRET_ACCESS_KEY unset; skipping restore account." >&2
fi

echo "minio-init: bucket ${BUCKET} is ready."
