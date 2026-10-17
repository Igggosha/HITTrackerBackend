// EN: Declares the dependency-injection token that separates resolved storage configuration from its consumers.
// UK: Оголошує токен впровадження залежностей, який відокремлює підготовлену конфігурацію сховища від її споживачів.

/**
 * Injection token for the resolved storage configuration.
 *
 * It lives in its own file so a test can provide a configuration without
 * importing the service, and the service without importing the module.
 */
export const STORAGE_CONFIG = 'STORAGE_CONFIG';
