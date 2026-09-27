# Error handling and request tracing

## What

The API assigns every request a safe `X-Request-Id` and returns it in the response
header. A global exception filter returns errors as `{ statusCode, error,
message, code?, details?, requestId, timestamp, path }`. Existing exception
fields remain in the envelope. Unhandled errors become a sanitized 500 response.

`nestjs-pino` writes structured request and application logs. Production uses
JSON; development uses readable output. Log entries carry the request ID, or
`system` for work outside a request. Request headers and bodies are omitted from
HTTP logs, and sensitive fields are redacted when present in other log objects.

## Why

Previously, error shapes varied by endpoint and server logs could not be tied
to a client's failure. The request ID connects a client error to server logs
without exposing stack traces or credentials. The filter keeps machine codes
used by the mobile app, including storage and registration errors.

## Demo

1. Start the API with `npm run start:dev` and send `GET /` with
   `X-Request-Id: demo_123`. The response header contains `demo_123`.
2. Send the same request with an invalid ID such as `bad.id`. The response
   header contains a generated UUID.
3. Request an unknown route. The error JSON contains `requestId`, `timestamp`,
   and `path`; the log entry uses the same ID.
4. Run `npx jest src/common --runInBand` to check code preservation, validation
   arrays, unknown error sanitization, throttling, and request headers.
