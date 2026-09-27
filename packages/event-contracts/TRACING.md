Kafka headers carry W3C `traceparent` and optional `tracestate`, separate from
the versioned event envelope. Consumers extract them with OpenTelemetry's
`propagation.extract(context.active(), headers)` and start a CONSUMER span in
the extracted context before handling the event. The event ID remains the
deduplication key; traces do not change delivery semantics.
