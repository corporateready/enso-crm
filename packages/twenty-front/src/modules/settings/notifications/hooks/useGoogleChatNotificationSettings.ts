import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback } from 'react';

import { DELETE_GOOGLE_CHAT_WEBHOOK_URL } from '@/settings/notifications/graphql/mutations/deleteGoogleChatWebhookUrl';
import { SEND_GOOGLE_CHAT_TEST_NOTIFICATION } from '@/settings/notifications/graphql/mutations/sendGoogleChatTestNotification';
import { SET_GOOGLE_CHAT_WEBHOOK_URL } from '@/settings/notifications/graphql/mutations/setGoogleChatWebhookUrl';
import { SET_NOTIFICATION_PREFERENCE } from '@/settings/notifications/graphql/mutations/setNotificationPreference';
import { GOOGLE_CHAT_WEBHOOK_SETTINGS } from '@/settings/notifications/graphql/queries/googleChatWebhookSettings';
import { NOTIFICATION_PREFERENCES } from '@/settings/notifications/graphql/queries/notificationPreferences';

// Local types until `graphql:generate --configuration=metadata` is run against
// the updated schema (which needs a booted server). The operations themselves
// match the GoogleChat* resolver and work at runtime regardless.
type GoogleChatWebhookSettings = {
  isConfigured: boolean;
  maskedWebhookUrl?: string | null;
};

type SettingsQueryData = {
  googleChatWebhookSettings: GoogleChatWebhookSettings;
};

type SetMutationData = {
  setGoogleChatWebhookUrl: GoogleChatWebhookSettings;
};

type SetMutationVariables = {
  input: { webhookUrl: string };
};

type TestMutationData = {
  sendGoogleChatTestNotification: { success: boolean; error?: string | null };
};

type NotificationPreference = { event: string; enabled: boolean };

type PreferencesQueryData = {
  notificationPreferences: NotificationPreference[];
};

type SetPreferenceData = {
  setNotificationPreference: NotificationPreference[];
};

type SetPreferenceVariables = { event: string; enabled: boolean };

export const useGoogleChatNotificationSettings = () => {
  const { data, loading, refetch } = useQuery<SettingsQueryData>(
    GOOGLE_CHAT_WEBHOOK_SETTINGS,
  );

  const [setWebhookUrlMutation, { loading: isSaving }] = useMutation<
    SetMutationData,
    SetMutationVariables
  >(SET_GOOGLE_CHAT_WEBHOOK_URL);

  const [deleteWebhookUrlMutation, { loading: isRemoving }] = useMutation(
    DELETE_GOOGLE_CHAT_WEBHOOK_URL,
  );

  const [sendTestMutation, { loading: isTesting }] =
    useMutation<TestMutationData>(SEND_GOOGLE_CHAT_TEST_NOTIFICATION);

  const { data: preferencesData, refetch: refetchPreferences } =
    useQuery<PreferencesQueryData>(NOTIFICATION_PREFERENCES);

  const [setPreferenceMutation] = useMutation<
    SetPreferenceData,
    SetPreferenceVariables
  >(SET_NOTIFICATION_PREFERENCE);

  const saveWebhookUrl = useCallback(
    async (webhookUrl: string) => {
      await setWebhookUrlMutation({ variables: { input: { webhookUrl } } });
      await refetch();
    },
    [setWebhookUrlMutation, refetch],
  );

  const removeWebhookUrl = useCallback(async () => {
    await deleteWebhookUrlMutation();
    await refetch();
  }, [deleteWebhookUrlMutation, refetch]);

  const sendTest = useCallback(async (): Promise<{
    success: boolean;
    error?: string | null;
  }> => {
    const result = await sendTestMutation();

    return (
      result.data?.sendGoogleChatTestNotification ?? {
        success: false,
        error: 'No response',
      }
    );
  }, [sendTestMutation]);

  const setPreference = useCallback(
    async (event: string, enabled: boolean) => {
      await setPreferenceMutation({ variables: { event, enabled } });
      await refetchPreferences();
    },
    [setPreferenceMutation, refetchPreferences],
  );

  return {
    settings: data?.googleChatWebhookSettings,
    loading,
    isSaving,
    isRemoving,
    isTesting,
    saveWebhookUrl,
    removeWebhookUrl,
    sendTest,
    preferences: preferencesData?.notificationPreferences ?? [],
    setPreference,
  };
};
