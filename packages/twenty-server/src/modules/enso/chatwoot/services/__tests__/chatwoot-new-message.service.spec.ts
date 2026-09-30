import { ChatwootNewMessageService } from 'src/modules/enso/chatwoot/services/chatwoot-new-message.service';

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

const thread = [
  {
    id: 10,
    content: 'Buna',
    incoming: true,
    isPrivate: false,
    senderName: null,
    createdAt: minutesAgo(90),
    attachments: [],
  },
  {
    id: 11,
    content: 'Salut!',
    incoming: false,
    isPrivate: false,
    senderName: null,
    createdAt: minutesAgo(60),
    attachments: [],
  },
  {
    id: 12,
    content: 'Cand pot veni la vizionare?',
    incoming: true,
    isPrivate: false,
    senderName: null,
    createdAt: minutesAgo(1),
    attachments: [],
  },
];

const build = (
  overrides: {
    opportunity?: Record<string, unknown> | null;
    cached?: boolean;
  } = {},
) => {
  const chatwootClient = {
    accountId: '1',
    listMessages: jest.fn().mockResolvedValue(thread),
    getConversationMeta: jest
      .fn()
      .mockResolvedValue({ channelType: 'Channel::Email' }),
  };
  const opportunity =
    overrides.opportunity === undefined
      ? { id: 'opportunity-1', ownerId: 'member-1', stage: 'CONNECTED' }
      : overrides.opportunity;
  const repositories: Record<string, unknown> = {
    inboundActivity: {
      find: jest
        .fn()
        .mockResolvedValue([
          { opportunityId: 'opportunity-1', platform: null },
        ]),
    },
    opportunity: { findOne: jest.fn().mockResolvedValue(opportunity) },
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn(
      async (_workspaceId: string, name: string) => repositories[name],
    ),
  };
  const managerNotificationService = {
    notifyNewMessage: jest.fn().mockResolvedValue(undefined),
  };
  const cacheStorage = {
    get: jest.fn().mockResolvedValue(overrides.cached ? true : undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new ChatwootNewMessageService(
      chatwootClient as never,
      globalWorkspaceOrmManager as never,
      managerNotificationService as never,
      cacheStorage as never,
    ),
    chatwootClient,
    managerNotificationService,
    cacheStorage,
  };
};

const payload = {
  event: 'message_created',
  id: 12,
  message_type: 'incoming',
  private: false,
  account: { id: 1 },
  conversation: { id: 998, channel: 'Channel::Email' },
};

describe('ChatwootNewMessageService', () => {
  const previousWorkspaceId = process.env.ENSO_TELEPHONY_WORKSPACE_ID;

  beforeAll(() => {
    process.env.ENSO_TELEPHONY_WORKSPACE_ID = 'workspace-1';
  });
  afterAll(() => {
    process.env.ENSO_TELEPHONY_WORKSPACE_ID = previousWorkspaceId;
  });
  beforeEach(() => jest.clearAllMocks());

  it('should notify the deal owner when the lead answers the manager', async () => {
    const { service, managerNotificationService, cacheStorage } = build();

    await service.handleMessageCreated(payload);

    expect(managerNotificationService.notifyNewMessage).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      opportunityId: 'opportunity-1',
      managerId: 'member-1',
      channelLabel: 'Email',
      preview: 'Cand pot veni la vizionare?',
    });
    expect(cacheStorage.set).toHaveBeenCalledWith(
      'new-message-notified:12',
      true,
      expect.any(Number),
    );
  });

  it('should not notify twice for the same message', async () => {
    const { service, managerNotificationService, chatwootClient } = build({
      cached: true,
    });

    await service.handleMessageCreated(payload);

    expect(chatwootClient.listMessages).not.toHaveBeenCalled();
    expect(managerNotificationService.notifyNewMessage).not.toHaveBeenCalled();
  });

  it('should ignore manager messages and other accounts without calling Chatwoot', async () => {
    const { service, chatwootClient } = build();

    await service.handleMessageCreated({
      ...payload,
      message_type: 'outgoing',
    });
    await service.handleMessageCreated({ ...payload, account: { id: 2 } });

    expect(chatwootClient.listMessages).not.toHaveBeenCalled();
  });

  it('should skip unclaimed or closed deals', async () => {
    for (const opportunity of [
      { id: 'opportunity-1', ownerId: null, stage: 'ROUTING' },
      { id: 'opportunity-1', ownerId: 'member-1', stage: 'CLOSED_LOST' },
      null,
    ]) {
      const { service, managerNotificationService } = build({ opportunity });

      await service.handleMessageCreated(payload);

      expect(
        managerNotificationService.notifyNewMessage,
      ).not.toHaveBeenCalled();
    }
  });

  it('should never throw into the webhook when Chatwoot fails', async () => {
    const { service, chatwootClient } = build();

    chatwootClient.listMessages.mockRejectedValue(new Error('timeout'));

    await expect(
      service.handleMessageCreated(payload),
    ).resolves.toBeUndefined();
  });
});
