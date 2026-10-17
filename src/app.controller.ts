// EN: Exposes the lightweight root health endpoint used to confirm that the API process is responding.
// UK: Надає легкий кореневий endpoint перевірки стану, який підтверджує, що процес API відповідає.

import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
