import { ProjectNotificationService } from 'src/modules/enso/lead-pipeline/services/project-notification.service';

// A call's deal opens the moment an individual accepts — about twenty seconds
// in, with the conversation still running — so nothing the row holds at that
// point is final. Observed live on 2026-09-17: a call rang ext 708, whose
// CANCELLED wrote ABANDONED, then ext 720, where Oleg answered and talked for 98
// seconds. The marketing room was told "Status: ABANDONED" while that call was
// still in progress; Moldcell's `history` push — Success, 98 sec — landed almost
// two minutes after the post had gone out.
//
// So the post waits for the provider's closing push, and the wait is what these
// tests pin down.

const OPPORTUNITY = {
  id: 'deal-id',
  projectId: 'project-id',
  pointOfContactId: undefined,
};

const CALL_IN_PROGRESS = {
  kind: 'INCOMING_CALL',
  callStatus: 'ABANDONED',
  salesPickup: true,
  calleeDid: '37376015472',
  submittedPayload: {
    'moldcell:event:INCOMING': {},
    'moldcell:event:CANCELLED': {},
    'moldcell:event:ACCEPTED': {},
  },
};

const CALL_SETTLED = {
  ...CALL_IN_PROGRESS,
  callStatus: 'ANSWERED',
  durationS: 98,
  submittedPayload: {
    ...CALL_IN_PROGRESS.submittedPayload,
    'moldcell:history': {},
  },
};

const buildService = (activityRow: Record<string, unknown> | undefined) => {
  const repositories: Record<string, { findOne: jest.Mock }> = {
    opportunity: { findOne: jest.fn().mockResolvedValue(OPPORTUNITY) },
    project: { findOne: jest.fn().mockResolvedValue({ name: 'ARTIMA' }) },
    person: { findOne: jest.fn().mockResolvedValue(undefined) },
    inboundActivity: { findOne: jest.fn().mockResolvedValue(activityRow) },
  };

  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback: () => unknown) => callback()),
    getRepository: jest.fn(async (_workspaceId: string, object: string) => {
      return repositories[object];
    }),
  };

  const projectChatWebhookService = {
    getWebhookUrl: jest.fn().mockResolvedValue('https://chat.example/hook'),
    post: jest.fn().mockResolvedValue(true),
  };

  const service = new ProjectNotificationService(
    globalWorkspaceOrmManager as never,
    projectChatWebhookService as never,
  );

  return { service, projectChatWebhookService };
};

const AUTH_CONTEXT = { workspace: { id: 'workspace-id' } } as never;

describe('ProjectNotificationService', () => {
  it('should hold the post while a call has no closing push yet', async () => {
    const { service, projectChatWebhookService } =
      buildService(CALL_IN_PROGRESS);

    const outcome = await service.notifyNewDeal(AUTH_CONTEXT, {
      opportunityId: 'deal-id',
    });

    expect(outcome).toBe('awaiting-call-outcome');
    expect(projectChatWebhookService.post).not.toHaveBeenCalled();
  });

  it('should post the call once its closing push has landed', async () => {
    const { service, projectChatWebhookService } = buildService(CALL_SETTLED);

    const outcome = await service.notifyNewDeal(AUTH_CONTEXT, {
      opportunityId: 'deal-id',
    });

    expect(outcome).toBe('posted');
    expect(projectChatWebhookService.post.mock.calls[0][1].text).toContain(
      'Status: ANSWERED',
    );
    expect(projectChatWebhookService.post.mock.calls[0][1].text).toContain(
      'Duration: 98 sec',
    );
  });

  // The give-up path, when the closing push never arrives. Late and incomplete
  // beats silent — but it must still not call a call abandoned that someone
  // demonstrably answered.
  it('should post without the closing push once the wait runs out', async () => {
    const { service, projectChatWebhookService } =
      buildService(CALL_IN_PROGRESS);

    const outcome = await service.notifyNewDeal(AUTH_CONTEXT, {
      opportunityId: 'deal-id',
      postWithoutFinalCallOutcome: true,
    });

    expect(outcome).toBe('posted');
    expect(projectChatWebhookService.post.mock.calls[0][1].text).toContain(
      'Status: ANSWERED',
    );
  });

  it('should post a form lead immediately — nothing about it is pending', async () => {
    const { service, projectChatWebhookService } = buildService({
      kind: 'FORM_SUBMISSION',
    });

    const outcome = await service.notifyNewDeal(AUTH_CONTEXT, {
      opportunityId: 'deal-id',
    });

    expect(outcome).toBe('posted');
    expect(projectChatWebhookService.post).toHaveBeenCalled();
  });

  it('should post a deal with no activity at all rather than waiting forever', async () => {
    const { service, projectChatWebhookService } = buildService(undefined);

    const outcome = await service.notifyNewDeal(AUTH_CONTEXT, {
      opportunityId: 'deal-id',
    });

    expect(outcome).toBe('posted');
    expect(projectChatWebhookService.post).toHaveBeenCalled();
  });
});
