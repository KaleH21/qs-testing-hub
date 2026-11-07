import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { approveTargetSchema, createTargetSchema } from '@qah/validation';
import type { z } from 'zod';
import { CurrentActor, OrgHeader, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { TargetsService } from './targets.service';

const int = new ParseIntPipe();

@ApiTags('targets')
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @OrgHeader() org?: number) {
    return this.targets.list(actor, org);
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Body(new ZodPipe(createTargetSchema)) dto: z.infer<typeof createTargetSchema>,
  ) {
    return this.targets.create(actor, org, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Param('id', int) id: number,
  ) {
    return this.targets.verify(actor, org, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Param('id', int) id: number,
    @Body(new ZodPipe(approveTargetSchema)) dto: z.infer<typeof approveTargetSchema>,
  ) {
    return this.targets.approve(actor, org, id, dto.reason);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Param('id', int) id: number,
  ) {
    await this.targets.remove(actor, org, id);
  }
}
