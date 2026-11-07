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
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCredentialSchema,
  createEnvironmentSchema,
  environmentVariablesSchema,
  toggleTestingSchema,
  updateCredentialSchema,
  updateEnvironmentSchema,
} from '@qah/validation';
import type { z } from 'zod';
import { CurrentActor, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { EnvironmentsService } from './environments.service';

const uuid = new ParseUUIDPipe();

@ApiTags('environments')
@Controller()
export class EnvironmentsController {
  constructor(private readonly envs: EnvironmentsService) {}

  @Get('projects/:projectId/environments')
  list(@CurrentActor() actor: Actor, @Param('projectId', uuid) projectId: string) {
    return this.envs.list(actor, projectId);
  }

  @Post('projects/:projectId/environments')
  create(
    @CurrentActor() actor: Actor,
    @Param('projectId', uuid) projectId: string,
    @Body(new ZodPipe(createEnvironmentSchema)) dto: z.infer<typeof createEnvironmentSchema>,
  ) {
    return this.envs.create(actor, projectId, dto);
  }

  @Get('environments/:envId')
  get(@CurrentActor() actor: Actor, @Param('envId', uuid) envId: string) {
    return this.envs.get(actor, envId);
  }

  @Patch('environments/:envId')
  update(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Body(new ZodPipe(updateEnvironmentSchema)) dto: z.infer<typeof updateEnvironmentSchema>,
  ) {
    return this.envs.update(actor, envId, dto);
  }

  @Delete('environments/:envId')
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('envId', uuid) envId: string) {
    await this.envs.remove(actor, envId);
  }

  @Patch('environments/:envId/testing')
  setTesting(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Body(new ZodPipe(toggleTestingSchema)) dto: z.infer<typeof toggleTestingSchema>,
  ) {
    return this.envs.setTesting(actor, envId, dto);
  }

  @Get('environments/:envId/variables')
  variables(@CurrentActor() actor: Actor, @Param('envId', uuid) envId: string) {
    return this.envs.variables(actor, envId);
  }

  @Put('environments/:envId/variables')
  replaceVariables(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Body(new ZodPipe(environmentVariablesSchema)) dto: z.infer<typeof environmentVariablesSchema>,
  ) {
    return this.envs.replaceVariables(actor, envId, dto);
  }

  @Get('environments/:envId/credentials')
  credentials(@CurrentActor() actor: Actor, @Param('envId', uuid) envId: string) {
    return this.envs.credentials(actor, envId);
  }

  @Post('environments/:envId/credentials')
  createCredential(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Body(new ZodPipe(createCredentialSchema)) dto: z.infer<typeof createCredentialSchema>,
  ) {
    return this.envs.createCredential(actor, envId, dto);
  }

  @Patch('environments/:envId/credentials/:id')
  updateCredential(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateCredentialSchema)) dto: z.infer<typeof updateCredentialSchema>,
  ) {
    return this.envs.updateCredential(actor, envId, id, dto);
  }

  @Delete('environments/:envId/credentials/:id')
  @HttpCode(204)
  async removeCredential(
    @CurrentActor() actor: Actor,
    @Param('envId', uuid) envId: string,
    @Param('id', uuid) id: string,
  ) {
    await this.envs.removeCredential(actor, envId, id);
  }
}
