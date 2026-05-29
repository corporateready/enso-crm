import { Injectable } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

// inboundActivity has no natural label. The n8n/Attio convention is
// "{Type} | {name-or-phone} | {project}" (e.g. "Call | +37379628432 | ARTIMA").
// We extend it with a timestamp: a person genuinely produces many inbound
// events (calls only dedup within a 10-min window), so without the time the
// label collapses to a wall of identical rows. Result, e.g.:
//   "Call · +37379628432 · ARTIMA · 2026-05-29 14:30"
// Computed on write (Twenty has no native lookup/computed field type).
type InboundActivityInput = {
  id?: string;
  kind?: string | null;
  personId?: string | null;
  projectId?: string | null;
  occurredAt?: string | Date | null;
  callerE164?: string | null;
  attendeeEmail?: string | null;
  name?: string | null;
};

const KIND_LABELS: Record<string, string> = {
  FORM_SUBMISSION: 'Form',
  INCOMING_CALL: 'Call',
  SOCIAL_MESSAGE: 'Social',
  LEAD_AD: 'Lead Ad',
  APPOINTMENT_BOOKED: 'Appointment',
  CALLBACK_REQUEST: 'Callback',
};

// "2026-05-29T14:30:00.000Z" -> "2026-05-29 14:30" (minute precision, UTC).
const formatOccurredAt = (value: string | Date | null | undefined): string => {
  if (!value) return '';

  const iso = value instanceof Date ? value.toISOString() : String(value);

  return iso.slice(0, 16).replace('T', ' ');
};

@Injectable()
export class InboundActivityNameService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async computeName(
    authContext: WorkspaceAuthContext,
    record: InboundActivityInput,
  ): Promise<string | undefined> {
    const workspace = authContext.workspace;

    if (!workspace) {
      return undefined;
    }

    const workspaceId = workspace.id;

    // Reference data (person, project) is read with a system context that
    // bypasses permission checks so the label computes for any caller
    // (webhook/API key/restricted Sales Manager) regardless of their perms.
    const systemAuthContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        let kind = record.kind ?? undefined;
        let personId = record.personId ?? undefined;
        let projectId = record.projectId ?? undefined;
        let occurredAt = record.occurredAt ?? undefined;
        let callerE164 = record.callerE164 ?? undefined;
        let attendeeEmail = record.attendeeEmail ?? undefined;

        // On update the payload only carries changed fields. Backfill the rest
        // from the existing row so the full label can always be rebuilt.
        const needsBackfill =
          !kind ||
          (!personId && !callerE164 && !attendeeEmail) ||
          !projectId ||
          !occurredAt;

        if (needsBackfill && record.id) {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'inboundActivity',
              { shouldBypassPermissionChecks: true },
            );

          const existing = await repository.findOne({
            where: { id: record.id },
          });

          kind = kind ?? existing?.kind ?? undefined;
          personId = personId ?? existing?.personId ?? undefined;
          projectId = projectId ?? existing?.projectId ?? undefined;
          occurredAt = occurredAt ?? existing?.occurredAt ?? undefined;
          callerE164 = callerE164 ?? existing?.callerE164 ?? undefined;
          attendeeEmail = attendeeEmail ?? existing?.attendeeEmail ?? undefined;
        }

        // Subject: prefer the resolved Person's name, else the raw caller phone
        // (calls), else the attendee email (appointments).
        let who = '';

        if (personId) {
          const personRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'person',
              { shouldBypassPermissionChecks: true },
            );

          const person = await personRepository.findOne({
            where: { id: personId },
          });

          const firstName = person?.name?.firstName ?? '';
          const lastName = person?.name?.lastName ?? '';

          who = `${firstName} ${lastName}`.trim();
        }

        if (!who) {
          who = callerE164 || attendeeEmail || '';
        }

        let projectName = '';

        if (projectId) {
          const projectRepository =
            await this.globalWorkspaceOrmManager.getRepository<any>(
              workspaceId,
              'project',
              { shouldBypassPermissionChecks: true },
            );

          const project = await projectRepository.findOne({
            where: { id: projectId },
          });

          projectName = project?.name ?? '';
        }

        const kindLabel = kind ? (KIND_LABELS[kind] ?? kind) : '';
        const timePart = formatOccurredAt(occurredAt);

        const parts = [kindLabel, who, projectName, timePart].filter(Boolean);

        return parts.length > 0 ? parts.join(' · ') : undefined;
      },
      systemAuthContext,
    );
  }
}
