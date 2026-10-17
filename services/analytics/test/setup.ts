// EN: Silences expected NestJS logs during analytics tests so failures remain readable.
// UK: Вимикає очікувані журнали NestJS під час тестів аналітики, щоб помилки залишалися читабельними.

import { Logger } from '@nestjs/common';

// Keep test output readable; log content is asserted where it matters.
Logger.overrideLogger(false);
