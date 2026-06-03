import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { useIsPageLayoutInEditMode } from '@/page-layout/hooks/useIsPageLayoutInEditMode';
import { WidgetSkeletonLoader } from '@/page-layout/widgets/components/WidgetSkeletonLoader';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Marker path that flags an iframe widget as the dynamic Chatwoot embed. Set as
// the widget's `configuration.url` (a real https URL so it passes `@IsUrl`
// validation, e.g. `https://crm.enso.ro/__enso_chatwoot_conversation`). The host
// is never loaded — IframeWidget intercepts on this marker.
export const ENSO_CHATWOOT_CONVERSATION_MARKER = '__enso_chatwoot_conversation';

// ENSO Phase 5 — the embedded Chatwoot conversation(s). Rendered by IframeWidget
// when a tab's iframe URL carries ENSO_CHATWOOT_CONVERSATION_MARKER. Flow (D6):
//   1. ask the server to mint a 5-min SSO URL + the deal's conversation list
//   2. load the SSO URL once → establishes the same-site session cookie
//   3. deep-link the iframe to the selected conversation (switcher when >1)
// A deal can have several conversations (FB/IG/multiple threads); we show all.

const StyledContainer = styled.div<{ $isEditMode: boolean }>`
  background: ${themeCssVariables.background.primary};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  pointer-events: ${({ $isEditMode }) => ($isEditMode ? 'none' : 'auto')};
  position: relative;
  width: 100%;
`;

const StyledIframe = styled.iframe<{ $isEditMode: boolean }>`
  border: none;
  flex: 1;
  height: 100%;
  pointer-events: ${({ $isEditMode }) => ($isEditMode ? 'none' : 'auto')};
  width: 100%;
`;

const StyledLoadingContainer = styled.div`
  background: ${themeCssVariables.background.primary};
  inset: 0;
  padding-left: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[2]};
  pointer-events: none;
  position: absolute;
  z-index: 1;
`;

const StyledMessageContainer = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  height: 100%;
  justify-content: center;
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

const StyledSwitcher = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledSwitcherTab = styled.button<{ $active: boolean }>`
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
  font-weight: ${({ $active }) =>
    $active
      ? themeCssVariables.font.weight.medium
      : themeCssVariables.font.weight.regular};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

type EmbedConversation = {
  conversationId: string;
  label: string;
  url: string;
};

type SsoResponse = {
  available: boolean;
  ssoUrl?: string;
  conversations?: EmbedConversation[];
};

type EmbedStatus =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'error' }
  | { phase: 'ready'; ssoUrl: string; conversations: EmbedConversation[] };

export const ChatwootConversationEmbed = () => {
  const isPageLayoutInEditMode = useIsPageLayoutInEditMode();
  const { targetRecordIdentifier } = useLayoutRenderingContext();

  const opportunityId = targetRecordIdentifier?.id;

  const [status, setStatus] = useState<EmbedStatus>({ phase: 'loading' });
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Two-step deep-link: load the SSO URL first, then the conversation.
  const [hasEstablishedSession, setHasEstablishedSession] = useState(false);

  useEffect(() => {
    if (!isDefined(opportunityId)) {
      setStatus({ phase: 'empty' });

      return;
    }

    let cancelled = false;

    setStatus({ phase: 'loading' });
    setSelectedIndex(0);
    setHasEstablishedSession(false);

    const token = getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;

    fetch(`${REST_API_BASE_URL}/enso/chatwoot/sso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isDefined(token) ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ opportunityId }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`SSO request failed (${response.status})`);
        }

        return response.json() as Promise<SsoResponse>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }

        if (
          !data.available ||
          !isDefined(data.ssoUrl) ||
          !isDefined(data.conversations) ||
          data.conversations.length === 0
        ) {
          setStatus({ phase: 'empty' });

          return;
        }

        setStatus({
          phase: 'ready',
          ssoUrl: data.ssoUrl,
          conversations: data.conversations,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ phase: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  if (status.phase === 'loading') {
    return (
      <StyledContainer $isEditMode={isPageLayoutInEditMode}>
        <StyledLoadingContainer>
          <WidgetSkeletonLoader />
        </StyledLoadingContainer>
      </StyledContainer>
    );
  }

  if (status.phase === 'empty') {
    return (
      <StyledContainer $isEditMode={isPageLayoutInEditMode}>
        <StyledMessageContainer>
          {t`No conversation linked to this deal yet.`}
        </StyledMessageContainer>
      </StyledContainer>
    );
  }

  if (status.phase === 'error') {
    return (
      <StyledContainer $isEditMode={isPageLayoutInEditMode}>
        <StyledMessageContainer>
          {t`Couldn't load the conversation. Try reopening this tab.`}
        </StyledMessageContainer>
      </StyledContainer>
    );
  }

  const selected =
    status.conversations[selectedIndex] ?? status.conversations[0];
  const src = hasEstablishedSession ? selected.url : status.ssoUrl;

  return (
    <StyledContainer $isEditMode={isPageLayoutInEditMode}>
      {status.conversations.length > 1 && (
        <StyledSwitcher>
          {status.conversations.map((conversation, index) => (
            <StyledSwitcherTab
              key={conversation.conversationId}
              $active={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
            >
              {conversation.label}
            </StyledSwitcherTab>
          ))}
        </StyledSwitcher>
      )}
      <StyledIframe
        // Re-mount per conversation so switching reloads the iframe to the new
        // deep-link (the SSO session cookie is already set after the first load).
        key={hasEstablishedSession ? selected.conversationId : 'sso'}
        $isEditMode={isPageLayoutInEditMode}
        src={src}
        title="Conversation"
        onLoad={() => {
          if (!hasEstablishedSession) {
            setHasEstablishedSession(true);
          }
        }}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        allow="encrypted-media"
        allowFullScreen
      />
    </StyledContainer>
  );
};
