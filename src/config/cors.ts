// EN: Resolves allowed browser origins while permitting native mobile requests that correctly omit the Origin header.
// UK: Визначає дозволені джерела браузера та пропускає запити мобільних застосунків, які коректно не надсилають заголовок Origin.

const LOCAL_DEVELOPMENT_ORIGIN = 'http://localhost:5173';

export function getAllowedCorsOrigins(environment = process.env): string[] {
  const configured = environment.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) return configured;
  return environment.NODE_ENV === 'production'
    ? []
    : [LOCAL_DEVELOPMENT_ORIGIN];
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  // Native mobile clients do not send an Origin header; CORS is a browser policy.
  return !origin || getAllowedCorsOrigins().includes(origin);
}
