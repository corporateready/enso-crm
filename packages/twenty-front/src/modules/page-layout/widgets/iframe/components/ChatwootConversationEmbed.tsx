import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { WidgetSkeletonLoader } from '@/page-layout/widgets/components/WidgetSkeletonLoader';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Marker path that flags an iframe widget as the native Chatwoot chat panel. Set
// as the widget's `configuration.url` (a real https URL so it passes `@IsUrl`,
// e.g. `https://crm.enso.ro/__enso_chatwoot_conversation`); IframeWidget renders
// this component instead of an iframe when it sees the marker.
export const ENSO_CHATWOOT_CONVERSATION_MARKER = '__enso_chatwoot_conversation';

// ENSO Phase 5 — native, chrome-free chat for the deal's Chatwoot conversation(s).
// No iframe / no Chatwoot dashboard UI: messages + a reply box, served by our
// server proxying Chatwoot's API (token stays server-side). A deal can have
// several conversations (FB/IG/threads) — list newest-first with a switcher;
// messages render oldest→newest (newest at the bottom) and poll every 3s.
const POLL_MS = 3000;

const StyledContainer = styled.div`
  background: ${themeCssVariables.background.primary};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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

// column-reverse keeps the view pinned to the newest message (visually at the
// bottom) with no scroll-ref needed — we render the array newest-first into it.
const StyledMessages = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  gap: ${themeCssVariables.spacing[2]};
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

const StyledComposer = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-shrink: 0;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledTextarea = styled.textarea`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  max-height: 120px;
  min-height: 36px;
  padding: ${themeCssVariables.spacing[2]};
  resize: none;
`;

const StyledSend = styled.button`
  background: ${themeCssVariables.color.blue};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.inverted};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: 0 ${themeCssVariables.spacing[3]};

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
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

type Conversation = {
  conversationId: string;
  label: string;
  channelType: string | null;
};

type Message = {
  id: number;
  content: string;
  incoming: boolean;
  senderName: string | null;
  createdAt: string | null;
};

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

export const ChatwootConversationEmbed = () => {
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const opportunityId = targetRecordIdentifier?.id;

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  // Load the deal's conversations once (and pick the newest).
  useEffect(() => {
    if (!isDefined(opportunityId)) {
      setLoading(false);

      return;
    }

    let cancelled = false;

    setLoading(true);

    fetch(
      `${REST_API_BASE_URL}/enso/chatwoot/conversations?opportunityId=${opportunityId}`,
      { headers: authHeaders() },
    )
      .then((response) =>
        response.ok ? response.json() : { conversations: [] },
      )
      .then((data: { conversations?: Conversation[] }) => {
        if (cancelled) {
          return;
        }

        const list = data.conversations ?? [];

        setConversations(list);
        setSelectedId(list[0]?.conversationId ?? null);
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
  }, [opportunityId]);

  // Poll the selected conversation's messages.
  useEffect(() => {
    if (!isDefined(opportunityId) || !isDefined(selectedId)) {
      return;
    }

    let cancelled = false;

    const load = () => {
      fetch(
        `${REST_API_BASE_URL}/enso/chatwoot/messages?opportunityId=${opportunityId}&conversationId=${selectedId}`,
        { headers: authHeaders() },
      )
        .then((response) => (response.ok ? response.json() : { messages: [] }))
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
  }, [opportunityId, selectedId]);

  const send = () => {
    const content = draft.trim();

    if (!isDefined(opportunityId) || !isDefined(selectedId) || content === '') {
      return;
    }

    setSending(true);

    fetch(`${REST_API_BASE_URL}/enso/chatwoot/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        opportunityId,
        conversationId: selectedId,
        content,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('send failed');
        }

        return response.json();
      })
      .then((data: { message?: Message }) => {
        setDraft('');
        if (isDefined(data.message)) {
          setMessages((previous) => [...previous, data.message as Message]);
        }
      })
      .catch(() => {})
      .finally(() => setSending(false));
  };

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
    <StyledContainer>
      {conversations.length > 1 && (
        <StyledSwitcher>
          {conversations.map((conversation) => (
            <StyledTab
              key={conversation.conversationId}
              $active={conversation.conversationId === selectedId}
              onClick={() => setSelectedId(conversation.conversationId)}
            >
              {conversation.label}
            </StyledTab>
          ))}
        </StyledSwitcher>
      )}

      <StyledMessages>
        {[...messages].reverse().map((message) => (
          <StyledRow key={message.id} $incoming={message.incoming}>
            <div>
              <StyledBubble $incoming={message.incoming}>
                {message.content}
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
        <StyledTextarea
          value={draft}
          placeholder={t`Type a reply…`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <StyledSend disabled={sending || draft.trim() === ''} onClick={send}>
          {sending ? t`Sending…` : t`Send`}
        </StyledSend>
      </StyledComposer>
    </StyledContainer>
  );
};
