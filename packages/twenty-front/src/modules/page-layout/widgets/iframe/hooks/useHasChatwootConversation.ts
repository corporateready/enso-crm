import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';

// 'loading' until we know; 'error' on a failed check so the caller can fall back
// to showing the tab (lands on the embed's empty state) rather than hiding it.
export type ChatwootTabPresence = 'loading' | 'present' | 'absent' | 'error';

type UseHasChatwootConversationParams = {
  recordType: 'opportunity' | 'person';
  recordId: string | undefined;
  // Only fetch when a Chatwoot tab is actually present on the page layout.
  enabled: boolean;
};

// Cheap DB-only presence check (rest/enso/chatwoot/has-conversation) used to
// decide whether the Conversation tab should render at all.
export const useHasChatwootConversation = ({
  recordType,
  recordId,
  enabled,
}: UseHasChatwootConversationParams): ChatwootTabPresence => {
  const [presence, setPresence] = useState<ChatwootTabPresence>('loading');

  useEffect(() => {
    if (!enabled || !isDefined(recordId)) {
      return;
    }

    let cancelled = false;

    setPresence('loading');

    const token = getTokenPair()?.accessOrWorkspaceAgnosticToken?.token;
    const headers: Record<string, string> = isDefined(token)
      ? { Authorization: `Bearer ${token}` }
      : {};

    fetch(
      `${REST_API_BASE_URL}/enso/chatwoot/has-conversation?recordType=${recordType}&recordId=${recordId}`,
      { headers },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { hasConversation?: boolean } | null) => {
        if (cancelled) {
          return;
        }

        if (!isDefined(data)) {
          setPresence('error');

          return;
        }

        setPresence(data.hasConversation === true ? 'present' : 'absent');
      })
      .catch(() => {
        if (!cancelled) {
          setPresence('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordType, recordId, enabled]);

  return presence;
};
