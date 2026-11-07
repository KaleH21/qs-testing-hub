import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../config/env';
import { AccessService } from './access/access.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { JWT_KEYS } from './auth/auth.constants';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { JwtKeys } from './auth/crypto';
import { EnvironmentsController } from './environments/environments.controller';
import { EnvironmentsService } from './environments/environments.service';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { SecretsController } from './secrets/secrets.controller';
import { SecretsService } from './secrets/secrets.service';
import { Vault, VAULT } from './secrets/vault';
import { ServiceAccountsController } from './service-accounts/service-accounts.controller';
import { ServiceAccountsService } from './service-accounts/service-accounts.service';
import { TargetsController } from './targets/targets.controller';
import { TargetsService, TargetVerifier } from './targets/targets.service';

/** Phase 1 (docs/12): auth, tổ chức, RBAC, dự án, môi trường, secret, allowlist, audit */
@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    ServiceAccountsController,
    ProjectsController,
    EnvironmentsController,
    SecretsController,
    TargetsController,
    AuditController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: JWT_KEYS, inject: [ENV], useFactory: (env: Env) => new JwtKeys(env.JWT_SECRET) },
    { provide: VAULT, inject: [ENV], useFactory: (env: Env) => Vault.fromEnv(env) },
    TargetVerifier,
    AccessService,
    AuditService,
    AuthService,
    OrganizationsService,
    ServiceAccountsService,
    ProjectsService,
    EnvironmentsService,
    SecretsService,
    TargetsService,
  ],
  exports: [AuthService, VAULT],
})
export class FoundationModule {}
