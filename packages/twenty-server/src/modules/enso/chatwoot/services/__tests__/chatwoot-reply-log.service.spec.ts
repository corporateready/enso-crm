import { ChatwootReplyLogService } from 'src/modules/enso/chatwoot/services/chatwoot-reply-log.service';

const buildService = (
  overrides: { save?: jest.Mock; insert?: jest.Mock } = {},
) => {
  const save = overrides.save ?? jest.fn().mockResolvedValue({});
  const insert = overrides.insert ?? jest.fn().mockResolvedValue({});
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => Promise<void>) =>
      callback(),
    ),
    getRepository: jest.fn(async (_workspaceId: string, objectName: string) =>
      objectName === 'outboundActivity' ? { save } : { insert },
    ),
  };

  return {
    service: new ChatwootReplyLogService(globalWorkspaceOrmManager as never),
    save,
    insert,
  };
};

const conversation = {
  conversationId: '998',
  platform: null,
  createdAt: null,
  opportunityId: 'opportunity-1',
  opportunityName: null,
  projectId: 'project-1',
  projectName: null,
  personId: 'person-1',
  personName: null,
};

const message = {
  id: 3601,
  content: 'Buna ziua',
  incoming: false,
  isPrivate: false,
  senderName: 'Alexandr',
  createdAt: '2026-09-30T20:00:00.000Z',
  attachments: [],
};

const emailMeta = {
  conversationId: '998',
  contactName: 'Ion Popescu',
  channelType: 'Channel::Email',
  status: 'open',
  canReply: true,
  assigneeName: null,
  assigneeId: null,
  createdAt: null,
  lastActivityAt: null,
  mailSubject: 'Aici prezentarea promisă',
  contactEmail: 'ion@gmail.com',
};

describe('ChatwootReplyLogService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should log an email reply as an EMAIL outboundActivity attributed to the manager', async () => {
    const { service, save, insert } = buildService();

    await service.logReply({
      workspaceId: 'workspace-1',
      conversation,
      meta: emailMeta,
      message,
      content: ' Buna ziua ',
      attachmentCount: 0,
      workspaceMemberId: 'member-1',
      senderName: 'Alexandr Olvanica',
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        loggedVia: 'CRM_INITIATED',
        deliveryStatus: 'SENT',
        subject: 'Re: Aici prezentarea promisă',
        body: 'Buna ziua',
        externalId: '3601',
        externalThreadId: '998',
        toIdentity: 'ion@gmail.com',
        fromIdentity: 'Alexandr Olvanica',
        personId: 'person-1',
        opportunityId: 'opportunity-1',
        performedById: 'member-1',
      }),
    );
    const rows = insert.mock.calls[0][0];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'enso-event.email-sent',
      workspaceMemberId: 'member-1',
      properties: {
        segments: [
          { text: 'Replied by email · ' },
          { text: 'Re: Aici prezentarea promisă' },
        ],
      },
    });
  });

  it('should log a social reply as SOCIAL and note attachments in the body', async () => {
    const { service, save, insert } = buildService();

    await service.logReply({
      workspaceId: 'workspace-1',
      conversation: { ...conversation, platform: 'INSTAGRAM' },
      meta: {
        ...emailMeta,
        channelType: 'Channel::Instagram',
        mailSubject: null,
        contactEmail: null,
      },
      message,
      content: undefined,
      attachmentCount: 2,
      workspaceMemberId: 'member-1',
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'SOCIAL',
        body: '[2 attachments]',
        toIdentity: 'Ion Popescu',
      }),
    );
    expect(save.mock.calls[0][0]).not.toHaveProperty('subject');
    expect(insert.mock.calls[0][0][0]).toMatchObject({
      name: 'enso-event.message-sent',
      properties: { segments: [{ text: 'Replied on Instagram' }] },
    });
  });

  it('should never throw when the log write fails, because the reply is already sent', async () => {
    const { service } = buildService({
      save: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      service.logReply({
        workspaceId: 'workspace-1',
        conversation,
        meta: null,
        message,
        content: 'hi',
        attachmentCount: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('should skip logging when the conversation has neither a person nor a deal', async () => {
    const { service, save } = buildService();

    await service.logReply({
      workspaceId: 'workspace-1',
      conversation: { ...conversation, personId: null, opportunityId: null },
      meta: emailMeta,
      message,
      content: 'hi',
      attachmentCount: 0,
    });

    expect(save).not.toHaveBeenCalled();
  });
});
