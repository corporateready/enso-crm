import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { useIsPageLayoutInEditMode } from '@/page-layout/hooks/useIsPageLayoutInEditMode';
import { PageLayoutWidgetNoDataDisplay } from '@/page-layout/widgets/components/PageLayoutWidgetNoDataDisplay';
import { WidgetSkeletonLoader } from '@/page-layout/widgets/components/WidgetSkeletonLoader';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// Marker path that flags an iframe widget as the dynamic Chatwoot embed. Set as
// the widget's `configuration.url` (a real https URL so it passes `@IsUrl`
// validation, e.g. `https://crm.enso.ro/__enso_chatwoot_conversation`). The host
// is never loaded — IframeWidget intercepts on this marker.
export const ENSO_CHATWOOT_CONVERSATION_MARKER = '__enso_chatwoot_conversation';

// ENSO Phase 5 — the embedded Chatwoot conversation. Rendered by IframeWidget
// when a tab's iframe URL carries ENSO_CHATWOOT_CONVERSATION_MARKER. The flow (D6):
//   1. ask the server to mint a fresh 5-min SSO URL for THIS manager + deal
//   2. load that URL in the iframe → establishes the same-site session cookie
//   3. once it loads, swap src to the conversation deep-link
// Server + cookie/CSP prerequisites: SSO endpoint + crm.enso.ro custom domain.

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
  bottom: 0;
  left: 0;
  padding-left: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[2]};
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 1;
`;

const StyledMessageContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: center;
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

type SsoResponse = {
  available: boolean;
  ssoUrl?: string;
  conversationUrl?: string;
  conversationId?: string;
};

type EmbedStatus =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'error' }
  | { phase: 'ready'; ssoUrl: string; conversationUrl: string };

export const ChatwootConversationEmbed = () => {
  const isPageLayoutInEditMode = useIsPageLayoutInEditMode();
  const { targetRecordIdentifier } = useLayoutRenderingContext();

  const opportunityId = targetRecordIdentifier?.id;

  const [status, setStatus] = useState<EmbedStatus>({ phase: 'loading' });
  // The two-step deep-link: load the SSO URL first, then the conversation.
  const [hasEstablishedSession, setHasEstablishedSession] = useState(false);

  useEffect(() => {
    if (!isDefined(opportunityId)) {
      setStatus({ phase: 'unavailable' });

      return;
    }

    let cancelled = false;

    setStatus({ phase: 'loading' });
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
          !isDefined(data.conversationUrl)
        ) {
          setStatus({ phase: 'unavailable' });

          return;
        }

        setStatus({
          phase: 'ready',
          ssoUrl: data.ssoUrl,
          conversationUrl: data.conversationUrl,
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

  if (status.phase === 'unavailable' || status.phase === 'error') {
    return (
      <StyledContainer $isEditMode={isPageLayoutInEditMode}>
        <StyledMessageContainer>
          <PageLayoutWidgetNoDataDisplay />
        </StyledMessageContainer>
      </StyledContainer>
    );
  }

  const src = hasEstablishedSession ? status.conversationUrl : status.ssoUrl;

  return (
    <StyledContainer $isEditMode={isPageLayoutInEditMode}>
      <StyledIframe
        $isEditMode={isPageLayoutInEditMode}
        src={src}
        title="Conversation"
        onLoad={() => {
          // First load = the SSO URL established the session → deep-link now.
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
