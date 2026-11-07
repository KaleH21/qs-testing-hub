import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { changePasswordSchema, loginSchema, setupSchema, updateMeSchema } from '@qah/validation';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentActor, Public, type Actor } from '../../common/actor';
import { AppError } from '../../common/app-error';
import { ZodPipe } from '../../common/zod.pipe';
import { ENV, type Env } from '../../config/env';
import { CSRF_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';
import { requestInfo } from './auth.guard';
import { AuthService, type IssuedSession } from './auth.service';
import { randomToken, safeEqualHex, sha256 } from './crypto';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get secure() {
    return this.env.COOKIE_SECURE
      ? this.env.COOKIE_SECURE === 'true'
      : this.env.DEPLOYMENT_MODE === 'server';
  }

  /** Refresh token trong cookie httpOnly; CSRF double-submit cho endpoint dùng cookie (docs/05 §2) */
  private respond(res: Response, s: IssuedSession) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: s.refreshExpiresAt,
    });
    res.cookie(CSRF_COOKIE, randomToken(16), {
      httpOnly: false,
      secure: this.secure,
      sameSite: 'strict',
      path: '/',
      expires: s.refreshExpiresAt,
    });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn };
  }

  private clearCookies(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Public()
  @Get('setup')
  async setupStatus() {
    return { needsSetup: await this.auth.needsSetup(), deploymentMode: this.env.DEPLOYMENT_MODE };
  }

  @Public()
  @Post('setup')
  async setup(
    @Body(new ZodPipe(setupSchema)) dto: z.infer<typeof setupSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.status(201);
    return this.respond(res, await this.auth.setup(dto, requestInfo(req)));
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) dto: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(dto.email, dto.password, requestInfo(req)));
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeEqualHex(sha256(cookie), sha256(header))) {
      throw new AppError('FORBIDDEN', 403, 'Thiếu hoặc sai CSRF token');
    }
    try {
      return this.respond(
        res,
        await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], requestInfo(req)),
      );
    } catch (err) {
      this.clearCookies(res);
      throw err;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor);
    this.clearCookies(res);
  }

  @Post('auth/logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(actor);
    this.clearCookies(res);
  }

  @Get('auth/me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }

  @Patch('auth/me')
  updateMe(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(updateMeSchema)) dto: z.infer<typeof updateMeSchema>,
  ) {
    return this.auth.updateMe(actor, dto);
  }

  @Post('auth/change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(actor, dto.currentPassword, dto.newPassword);
  }

  @Get('auth/sessions')
  sessions(@CurrentActor() actor: Actor) {
    return this.auth.sessions(actor);
  }

  @Delete('auth/sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(actor, id);
  }
}
