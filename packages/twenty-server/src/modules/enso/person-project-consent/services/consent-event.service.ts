import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// Append-only audit trail for marketing consent. Every grant/revoke (from the
// intake pipeline OR a manual edit) writes an immutable personProjectConsentEvent
// alongside the personProjectConsent current-state row. Best-effort: a failed
// event write never breaks the consent change itself.
export type ConsentEventActor = {
  source: string;
  name: string;
  workspaceMemberId?: string;
  context?: Record<string, unknown>;
};

export type ConsentEventInput = {
  personId: string;
  projectId: string;
  channel: string; // email | sms | whatsapp | call (stored upper-cased)
  action: 'GRANTED' | 'REVOKED';
  source?: string | null;
  occurredAt?: string | null;
  inboundActivityId?: string | null;
  note?: string | null;
  actor: ConsentEventActor;
};

@Injectable()
export class ConsentEventService {
  private readonly logger = new Logger(ConsentEventService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async record(workspaceId: string, input: ConsentEventInput): Promise<void> {
    if (
      !workspaceId ||
      !isDefined(input.personId) ||
      !isDefined(input.projectId)
    ) {
      return;
    }

    const systemAuthContext = buildSystemAuthContext(workspaceId);

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );
          const projectRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: input.personId },
          });
          const project = await projectRepository.findOne({
            where: { id: input.projectId },
          });

          const personName = `${person?.name?.firstName ?? ''} ${
            person?.name?.lastName ?? ''
          }`.trim();
          const projectName = project?.name ?? '';
          const channelUpper = input.channel.toUpperCase();

          const name = [
            personName,
            projectName,
            `${channelUpper} ${input.action}`,
          ]
            .filter(Boolean)
            .join(' · ');

          const eventRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'personProjectConsentEvent',
              { shouldBypassPermissionChecks: true },
            );

          const lastPosition = await eventRepository.maximum(
            'position',
            undefined,
          );

          await eventRepository.insert({
            id: randomUUID(),
            personId: input.personId,
            projectId: input.projectId,
            channel: channelUpper,
            action: input.action,
            ...(isDefined(input.source) ? { source: input.source } : {}),
            occurredAt: input.occurredAt ?? new Date().toISOString(),
            ...(isDefined(input.inboundActivityId)
              ? { inboundActivityId: input.inboundActivityId }
              : {}),
            ...(isDefined(input.note) ? { note: input.note } : {}),
            name,
            position: (lastPosition ?? 0) + 1,
            createdBy: input.actor,
            updatedBy: input.actor,
          });
        },
        systemAuthContext,
      );
    } catch (error) {
      this.logger.warn(
        `Consent event record failed (${input.action} ${input.channel} for person ${input.personId}): ${(error as Error).message}`,
      );
    }
  }
}
