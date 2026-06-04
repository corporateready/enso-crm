import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { WidgetSkeletonLoader } from '@/page-layout/widgets/components/WidgetSkeletonLoader';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Marker URL that flags an iframe widget as the native Chatwoot chat panel (set
// as the widget's `configuration.url`, a real https URL so it passes `@IsUrl`).
export const ENSO_CHATWOOT_CONVERSATION_MARKER = '__enso_chatwoot_conversation';

// ENSO Phase 5 — native, chrome-free chat for the deal's Chatwoot conversation(s).
// Backed by our server proxying Chatwoot (token server-side). Focused on the
// messaging itself: conversation list (newest first), thread oldest→newest
// (column-reverse pins newest to the bottom), reply with emoji / canned responses
// (type "/") / file & image attachments. Polls every 3s. Mobile-friendly.
// (Chatwoot's assign/resolve/notes are intentionally omitted — assignment is
// CRM-driven, and the deal stage tracks lifecycle.)
const POLL_MS = 3000;

const QUICK_EMOJIS = [
  '👍',
  '🙏',
  '😊',
  '🎉',
  '❤️',
  '🔥',
  '✅',
  '👏',
  '😀',
  '😅',
  '🤝',
  '💯',
  '🙌',
  '👀',
  '🚀',
  '😍',
  '😂',
  '🤔',
  '😎',
  '👋',
  '💪',
  '✨',
  '📩',
  '📞',
];

const apiBase = `${REST_API_BASE_URL}/enso/chatwoot`;

const authHeaders = (): Record<string, string> => {
  const token = getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;

  return isDefined(token) ? { Authorization: `Bearer ${token}` } : {};
};

const formatTime = (iso: string | null): string => {
  if (!isDefined(iso)) {
    return '';
  }

  const date = new Date(iso);

  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

type Conversation = {
  conversationId: string;
  label: string;
  contactName: string | null;
  channelType: string | null;
  opportunityName: string | null;
};

type Attachment = {
  id: number;
  fileType: string | null;
  dataUrl: string | null;
  fileName: string | null;
};

type Message = {
  id: number;
  content: string;
  incoming: boolean;
  isPrivate: boolean;
  senderName: string | null;
  createdAt: string | null;
  attachments: Attachment[];
};

type Canned = { shortCode: string; content: string };

const StyledContainer = styled.div`
  background: ${themeCssVariables.background.primary};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  /* This component is a grid item inside WidgetCardContent; min-height:0 stops it
     expanding to content (which pushed the composer below the fold). */
  min-height: 0;
  overflow: hidden;
  position: relative;
  width: 100%;
`;

const StyledSwitcher = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[1]};
  overflow-x: auto;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledTab = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active
      ? themeCssVariables.background.tertiary
      : themeCssVariables.background.transparent.light};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ $active }) =>
    $active
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  white-space: nowrap;
`;

const StyledMessages = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 0;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledRow = styled.div<{ $incoming: boolean }>`
  display: flex;
  justify-content: ${({ $incoming }) =>
    $incoming ? 'flex-start' : 'flex-end'};
  width: 100%;
`;

const StyledBubble = styled.div<{ $incoming: boolean }>`
  background: ${({ $incoming }) =>
    $incoming
      ? themeCssVariables.background.secondary
      : themeCssVariables.color.blue};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${({ $incoming }) =>
    $incoming
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.inverted};
  font-size: ${themeCssVariables.font.size.md};
  max-width: 78%;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  white-space: pre-wrap;
  word-break: break-word;
`;

const StyledMeta = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledImage = styled.img`
  border-radius: ${themeCssVariables.border.radius.sm};
  display: block;
  margin-top: ${themeCssVariables.spacing[1]};
  max-height: 240px;
  max-width: 100%;
`;

const StyledFileLink = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  display: block;
  font-size: ${themeCssVariables.font.size.sm};
  margin-top: ${themeCssVariables.spacing[1]};
  padding: 0;
  text-decoration: underline;
`;

const StyledComposer = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
  position: relative;
`;

const StyledInputRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledTextarea = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  height: 36px;
  max-height: 120px;
  padding: ${themeCssVariables.spacing[2]};
  resize: none;
`;

const StyledIconButton = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.md};
  height: 36px;
  justify-content: center;
  width: 36px;
`;

const StyledSend = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  height: 36px;
  padding: 0 ${themeCssVariables.spacing[3]};

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const StyledChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledChip = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.tertiary};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledChipRemove = styled.button`
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  padding: 0;
`;

const StyledPopover = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  bottom: 100%;
  box-shadow: ${themeCssVariables.boxShadow.strong};
  left: ${themeCssVariables.spacing[2]};
  margin-bottom: ${themeCssVariables.spacing[1]};
  max-height: 220px;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[2]};
  position: absolute;
  right: ${themeCssVariables.spacing[2]};
  z-index: 10;
`;

const StyledEmojiGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: repeat(8, 1fr);
`;

const StyledEmoji = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.lg};
  padding: ${themeCssVariables.spacing[1]};
`;

const StyledCannedItem = styled.button`
  background: none;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: block;
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
`;

const StyledMessage = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  height: 100%;
  justify-content: center;
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

const StyledDropOverlay = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.strong};
  border: 2px dashed ${themeCssVariables.color.blue};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-size: ${themeCssVariables.font.size.md};
  inset: 0;
  justify-content: center;
  position: absolute;
  z-index: 20;
`;

// Image attachment: its proxy URL needs the Bearer header (which <img src> can't
// send), so fetch the bytes and render via an object URL.
const AttachmentImage = ({ src }: { src: string }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let created: string | null = null;

    fetch(src, { headers: authHeaders() })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (isDefined(blob)) {
          created = URL.createObjectURL(blob);
          setObjectUrl(created);
        }
      })
      .catch(() => {});

    return () => {
      if (isDefined(created)) {
        URL.revokeObjectURL(created);
      }
    };
  }, [src]);

  return isDefined(objectUrl) ? (
    <StyledImage src={objectUrl} alt={t`Attachment`} />
  ) : null;
};

const downloadAttachment = (src: string, fileName: string) => {
  fetch(src, { headers: authHeaders() })
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => {
      if (!isDefined(blob)) {
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch(() => {});
};

export const ChatwootConversationEmbed = () => {
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const recordId = targetRecordIdentifier?.id;
  // The panel works from an opportunity (the deal's chats) or a person (all their
  // chats across deals, labelled by opportunity).
  const recordType =
    targetRecordIdentifier?.targetObjectNameSingular === 'person'
      ? 'person'
      : 'opportunity';
  const isPersonView = recordType === 'person';

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [canned, setCanned] = useState<Canned[]>([]);

  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const recordQuery = `recordType=${recordType}&recordId=${recordId}`;

  const attachmentUrl = (dataUrl: string): string =>
    `${apiBase}/attachment?${recordQuery}&conversationId=${selectedId}&url=${encodeURIComponent(dataUrl)}`;

  // Initial load: conversations + canned responses.
  useEffect(() => {
    if (!isDefined(recordId)) {
      setLoading(false);

      return;
    }

    let cancelled = false;

    Promise.all([
      fetch(`${apiBase}/conversations?${recordQuery}`, {
        headers: authHeaders(),
      }).then((r) => (r.ok ? r.json() : { conversations: [] })),
      fetch(`${apiBase}/canned-responses`, { headers: authHeaders() }).then(
        (r) => (r.ok ? r.json() : { cannedResponses: [] }),
      ),
    ])
      .then(([conv, cr]) => {
        if (cancelled) {
          return;
        }

        const list: Conversation[] = conv.conversations ?? [];

        setConversations(list);
        setSelectedId(list[0]?.conversationId ?? null);
        setCanned(cr.cannedResponses ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordId, recordType, recordQuery]);

  // Poll the selected conversation's messages.
  useEffect(() => {
    if (!isDefined(recordId) || !isDefined(selectedId)) {
      return;
    }

    let cancelled = false;

    const load = () => {
      fetch(`${apiBase}/messages?${recordQuery}&conversationId=${selectedId}`, {
        headers: authHeaders(),
      })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((data: { messages?: Message[] }) => {
          if (!cancelled) {
            setMessages(data.messages ?? []);
          }
        })
        .catch(() => {});
    };

    load();
    const interval = setInterval(load, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [recordId, recordType, recordQuery, selectedId]);

  const send = () => {
    const content = draft.trim();

    if (
      !isDefined(recordId) ||
      !isDefined(selectedId) ||
      (content === '' && files.length === 0)
    ) {
      return;
    }

    setSending(true);

    const form = new FormData();

    form.append('recordType', recordType);
    form.append('recordId', recordId);
    form.append('conversationId', selectedId);
    form.append('content', content);
    files.forEach((file) => form.append('attachments', file));

    fetch(`${apiBase}/reply`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    })
      .then((r) => {
        if (!r.ok) {
          throw new Error('send failed');
        }

        return r.json();
      })
      .then((data: { message?: Message }) => {
        setDraft('');
        setFiles([]);
        if (isDefined(data.message)) {
          setMessages((previous) => [...previous, data.message as Message]);
        }
      })
      .catch(() => {})
      .finally(() => setSending(false));
  };

  // Canned responses surface when the draft starts with "/".
  const cannedMatches = draft.startsWith('/')
    ? canned
        .filter((c) =>
          `${c.shortCode} ${c.content}`
            .toLowerCase()
            .includes(draft.slice(1).toLowerCase()),
        )
        .slice(0, 6)
    : [];

  if (loading) {
    return (
      <StyledContainer>
        <WidgetSkeletonLoader />
      </StyledContainer>
    );
  }

  if (!isDefined(selectedId) || conversations.length === 0) {
    return (
      <StyledContainer>
        <StyledMessage>{t`No conversation linked to this deal yet.`}</StyledMessage>
      </StyledContainer>
    );
  }

  return (
    <StyledContainer
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const dropped = Array.from(event.dataTransfer.files ?? []);

        if (dropped.length > 0) {
          setFiles((current) => [...current, ...dropped]);
        }
      }}
    >
      {isDragging && (
        <StyledDropOverlay>{t`Drop files to attach`}</StyledDropOverlay>
      )}
      <StyledSwitcher>
        {conversations.map((conversation) => (
          <StyledTab
            key={conversation.conversationId}
            $active={conversation.conversationId === selectedId}
            onClick={() => setSelectedId(conversation.conversationId)}
          >
            {isPersonView && isDefined(conversation.opportunityName)
              ? `${conversation.label} · ${conversation.opportunityName}`
              : conversation.label}
          </StyledTab>
        ))}
      </StyledSwitcher>

      <StyledMessages>
        {[...messages].reverse().map((message) => (
          <StyledRow key={message.id} $incoming={message.incoming}>
            <div>
              <StyledBubble $incoming={message.incoming}>
                {message.content}
                {message.attachments.map((attachment) =>
                  !isDefined(
                    attachment.dataUrl,
                  ) ? null : attachment.fileType === 'image' ? (
                    <AttachmentImage
                      key={attachment.id}
                      src={attachmentUrl(attachment.dataUrl)}
                    />
                  ) : (
                    <StyledFileLink
                      key={attachment.id}
                      onClick={() =>
                        downloadAttachment(
                          attachmentUrl(attachment.dataUrl as string),
                          attachment.fileName ?? 'attachment',
                        )
                      }
                    >
                      {attachment.fileName ?? t`Download file`}
                    </StyledFileLink>
                  ),
                )}
              </StyledBubble>
              <StyledMeta>
                {[message.senderName, formatTime(message.createdAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </StyledMeta>
            </div>
          </StyledRow>
        ))}
      </StyledMessages>

      <StyledComposer>
        {files.length > 0 && (
          <StyledChips>
            {files.map((file, index) => (
              <StyledChip key={`${file.name}-${index}`}>
                {file.name}
                <StyledChipRemove
                  onClick={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                >
                  ✕
                </StyledChipRemove>
              </StyledChip>
            ))}
          </StyledChips>
        )}

        {showEmoji && (
          <StyledPopover>
            <StyledEmojiGrid>
              {QUICK_EMOJIS.map((emoji) => (
                <StyledEmoji
                  key={emoji}
                  onClick={() => {
                    setDraft((d) => d + emoji);
                    setShowEmoji(false);
                  }}
                >
                  {emoji}
                </StyledEmoji>
              ))}
            </StyledEmojiGrid>
          </StyledPopover>
        )}

        {cannedMatches.length > 0 && (
          <StyledPopover>
            {cannedMatches.map((response) => (
              <StyledCannedItem
                key={response.shortCode}
                onClick={() => setDraft(response.content)}
              >
                {response.shortCode} — {response.content}
              </StyledCannedItem>
            ))}
          </StyledPopover>
        )}

        <StyledInputRow>
          <StyledIconButton
            title={t`Emoji`}
            onClick={() => setShowEmoji((v) => !v)}
          >
            🙂
          </StyledIconButton>
          <StyledIconButton as="label" title={t`Attach file`}>
            📎
            <input
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);

                setFiles((current) => [...current, ...picked]);
                event.target.value = '';
              }}
            />
          </StyledIconButton>
          <StyledTextarea
            value={draft}
            placeholder={t`Type a reply…`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <StyledSend
            disabled={sending || (draft.trim() === '' && files.length === 0)}
            onClick={send}
          >
            {sending ? t`Sending…` : t`Send`}
          </StyledSend>
        </StyledInputRow>
      </StyledComposer>
    </StyledContainer>
  );
};
