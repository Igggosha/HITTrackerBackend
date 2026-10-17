// EN: Re-exports the shared versioned event contracts while preserving existing backend import paths.
// UK: Повторно експортує спільні версіоновані контракти подій, зберігаючи наявні шляхи імпорту backend.

// Keep existing API imports stable while contracts live in one shared package.
export * from '../../packages/event-contracts/events';
