# Error handling and request tracing

## What

The API assigns every request a safe `X-Request-Id` and returns it in the response
header. A global exception filter returns errors as `{ statusCode, error,
message, code?, details?, requestId, timestamp, path }`. Existing exception
fields remain in the envelope. Unhandled errors become a sanitized 500 response.

Some errors happen before Nest's routing layer ever sees the request: helmet
and the `json`/`urlencoded` body parsers can reject a request (oversized body,
malformed JSON, unsupported charset, ...) before any controller or `NestModule`
middleware runs. Those errors are plain `Error` objects from `body-parser`/
`raw-body`/`http-errors`, never a `HttpException`, but they carry a numeric
`status`/`statusCode`. The filter recovers that status (400-599) instead of
collapsing it to a generic 500: a 4xx keeps its real status and, when
`http-errors` marks the error `expose: true`, its message; otherwise it falls
back to the standard status text. A machine-readable `code` is derived from
the status name (e.g. `PAYLOAD_TOO_LARGE` for 413). A library-reported 5xx
keeps its real status too, but the message/code are still sanitized and the
error is still logged, exactly like any other unhandled error.

For this to carry a request ID, request-id assignment has to run before
those pre-routing failures can happen. `configureApp`
(`src/config/configure-app.ts`) is the single place bootstrap middleware is
registered, and `main.ts` calls nothing else. Inside it, the request-id
middleware is the very first `app.use(...)`, ahead of helmet and the body
parsers; only after that does it apply the validation pipe, helmet, the body
parsers, the session store, and CORS, in that order. `AppModule` no longer
also binds the request-id middleware: Nest only wires up module-bound
middleware once the app initialises, which happens after every `app.use(...)`
call in `main.ts` — binding it a second time there would run it too late to
cover pre-routing failures, and (had the timing differed) could reassign the
id mid-request. The middleware itself is also idempotent (a second pass on an
already-tagged request is a no-op besides re-entering the async-local-storage
context), as defense in depth. The exception filter's `requestId` falls back
from `request.id` to the async-local-storage store so a response is never
missing one.

`test/bootstrap-order.e2e-spec.ts` boots a minimal Nest app through the same
`configureApp` function `main.ts` uses (so the tested middleware order cannot
drift from production) and asserts: an oversized JSON body answers 413 with
`code: "PAYLOAD_TOO_LARGE"` and a matching `X-Request-Id`; malformed JSON
answers 400 with a request id; and a normal route still gets an
`X-Request-Id` header. It does not require a database or `.env` secrets: it
stubs `DATABASE_URL`/`OAUTH_SESSION_SECRET` only so the (never-queried)
session store can construct, and it uses a small test module instead of the
full `AppModule`.

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
5. Run `npx jest --config ./test/jest-e2e.json test/bootstrap-order.e2e-spec.ts
   --runInBand` to check the real bootstrap order: pre-routing body-parser
   failures still get a request ID and the right status/code.
