const LOCAL_DEVELOPMENT_ORIGIN = 'http://localhost:5173';

export function getAllowedCorsOrigins(environment = process.env): string[] {
  const configured = environment.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) return configured;
  return environment.NODE_ENV === 'production' ? [] : [LOCAL_DEVELOPMENT_ORIGIN];
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  // Native mobile clients do not send an Origin header; CORS is a browser policy.
  return !origin || getAllowedCorsOrigins().includes(origin);
}
