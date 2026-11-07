import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createServiceAccountSchema, updateServiceAccountSchema } from '@qah/validation';
import type { z } from 'zod';
import { CurrentActor, OrgHeader, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { ServiceAccountsService } from './service-accounts.service';

const uuid = new ParseUUIDPipe();

@ApiTags('service-accounts')
@Controller('service-accounts')
export class ServiceAccountsController {
  constructor(private readonly sa: ServiceAccountsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @OrgHeader() org?: string) {
    return this.sa.list(actor, org);
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Body(new ZodPipe(createServiceAccountSchema)) dto: z.infer<typeof createServiceAccountSchema>,
  ) {
    return this.sa.create(actor, org, dto);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateServiceAccountSchema)) dto: z.infer<typeof updateServiceAccountSchema>,
  ) {
    return this.sa.update(actor, org, id, dto);
  }

  @Post(':id/rotate')
  rotate(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
  ) {
    return this.sa.rotate(actor, org, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
  ) {
    await this.sa.revoke(actor, org, id);
  }
}
