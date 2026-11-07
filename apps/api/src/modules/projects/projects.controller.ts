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
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createProjectSchema,
  projectMemberSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
} from '@qah/validation';
import { z } from 'zod';
import { CurrentActor, OrgHeader, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { ProjectsService } from './projects.service';

const int = new ParseIntPipe();
const listQuery = z.object({
  q: z.string().max(100).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.projects.list(actor, org, q.q, q.archived === 'true');
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Body(new ZodPipe(createProjectSchema)) dto: z.infer<typeof createProjectSchema>,
  ) {
    return this.projects.create(actor, org, dto);
  }

  @Get(':projectId')
  get(@CurrentActor() actor: Actor, @Param('projectId', int) id: number) {
    return this.projects.get(actor, id);
  }

  @Patch(':projectId')
  update(
    @CurrentActor() actor: Actor,
    @Param('projectId', int) id: number,
    @Body(new ZodPipe(updateProjectSchema)) dto: z.infer<typeof updateProjectSchema>,
  ) {
    return this.projects.update(actor, id, dto);
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  archive(@CurrentActor() actor: Actor, @Param('projectId', int) id: number) {
    return this.projects.setArchived(actor, id, true);
  }

  @Post(':projectId/unarchive')
  @HttpCode(200)
  unarchive(@CurrentActor() actor: Actor, @Param('projectId', int) id: number) {
    return this.projects.setArchived(actor, id, false);
  }

  @Get(':projectId/members')
  members(@CurrentActor() actor: Actor, @Param('projectId', int) id: number) {
    return this.projects.members(actor, id);
  }

  @Post(':projectId/members')
  addMember(
    @CurrentActor() actor: Actor,
    @Param('projectId', int) id: number,
    @Body(new ZodPipe(projectMemberSchema)) dto: z.infer<typeof projectMemberSchema>,
  ) {
    return this.projects.addMember(actor, id, dto);
  }

  @Patch(':projectId/members/:userId')
  updateMember(
    @CurrentActor() actor: Actor,
    @Param('projectId', int) id: number,
    @Param('userId', int) userId: number,
    @Body(new ZodPipe(updateProjectMemberSchema)) dto: z.infer<typeof updateProjectMemberSchema>,
  ) {
    return this.projects.updateMember(actor, id, userId, dto.role);
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentActor() actor: Actor,
    @Param('projectId', int) id: number,
    @Param('userId', int) userId: number,
  ) {
    await this.projects.removeMember(actor, id, userId);
  }
}
