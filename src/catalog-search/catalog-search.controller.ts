// EN: Exposes authenticated catalog search and derives visibility identity from the JWT principal rather than query input.
// UK: Надає автентифікований пошук каталогу та визначає ідентичність для перевірки видимості з JWT, а не з параметрів запиту.

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { CatalogSearchService } from './catalog-search.service';
import { CatalogSearchDto } from './dto/catalog-search.dto';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('user')
@Controller('catalog')
export class CatalogSearchController {
  constructor(private readonly search: CatalogSearchService) {}

  @Get('search')
  searchCatalog(@Req() request: Request, @Query() query: CatalogSearchDto) {
    return this.search.search(request.user!.id!, query);
  }
}
