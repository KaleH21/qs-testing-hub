import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addMemberSchema,
  localNetworkSchema,
  testingSwitchesSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@qah/validation';
import type { z } from 'zod';
import { CurrentActor, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { OrganizationsService } from './organizations.service';

const int = new ParseIntPipe();

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.orgs.list(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', int) id: number) {
    return this.orgs.get(actor, id);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Body(new ZodPipe(updateOrganizationSchema)) dto: z.infer<typeof updateOrganizationSchema>,
  ) {
    return this.orgs.update(actor, id, dto);
  }

  @Patch(':id/testing-switches')
  testingSwitches(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Body(new ZodPipe(testingSwitchesSchema)) dto: z.infer<typeof testingSwitchesSchema>,
  ) {
    return this.orgs.setTestingSwitches(actor, id, dto);
  }

  @Put(':id/local-network')
  localNetwork(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Body(new ZodPipe(localNetworkSchema)) dto: z.infer<typeof localNetworkSchema>,
  ) {
    return this.orgs.setLocalNetwork(actor, id, dto);
  }

  @Get(':id/members')
  members(@CurrentActor() actor: Actor, @Param('id', int) id: number) {
    return this.orgs.members(actor, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Body(new ZodPipe(addMemberSchema)) dto: z.infer<typeof addMemberSchema>,
  ) {
    return this.orgs.addMember(actor, id, dto);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Param('userId', int) userId: number,
    @Body(new ZodPipe(updateMemberSchema)) dto: z.infer<typeof updateMemberSchema>,
  ) {
    return this.orgs.updateMember(actor, id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentActor() actor: Actor,
    @Param('id', int) id: number,
    @Param('userId', int) userId: number,
  ) {
    await this.orgs.removeMember(actor, id, userId);
  }
}
