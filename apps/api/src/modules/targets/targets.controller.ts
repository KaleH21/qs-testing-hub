import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { approveTargetSchema, createTargetSchema } from '@qah/validation';
import type { z } from 'zod';
import { CurrentActor, OrgHeader, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { TargetsService } from './targets.service';

const uuid = new ParseUUIDPipe();

@ApiTags('targets')
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @OrgHeader() org?: string) {
    return this.targets.list(actor, org);
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Body(new ZodPipe(createTargetSchema)) dto: z.infer<typeof createTargetSchema>,
  ) {
    return this.targets.create(actor, org, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
  ) {
    return this.targets.verify(actor, org, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(approveTargetSchema)) dto: z.infer<typeof approveTargetSchema>,
  ) {
    return this.targets.approve(actor, org, id, dto.reason);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: string | undefined,
    @Param('id', uuid) id: string,
  ) {
    await this.targets.remove(actor, org, id);
  }
}
