import { useState } from 'react';

import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { useGoogleChatNotificationSettings } from '@/settings/notifications/hooks/useGoogleChatNotificationSettings';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { Trans, useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { H2Title, IconCheck } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledInstructions = styled.ol`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.6;
  margin: 0 0 ${themeCssVariables.spacing[4]};
  padding-left: ${themeCssVariables.spacing[4]};
`;

const StyledButtonRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  margin-top: ${themeCssVariables.spacing[3]};
`;

const StyledStatus = styled.div`
  align-items: center;
  color: ${themeCssVariables.color.green};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  margin-bottom: ${themeCssVariables.spacing[2]};
`;

export const SettingsNotifications = () => {
  const { t } = useLingui();

  const {
    settings,
    isSaving,
    isRemoving,
    isTesting,
    saveWebhookUrl,
    removeWebhookUrl,
    sendTest,
  } = useGoogleChatNotificationSettings();

  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  const [webhookUrl, setWebhookUrl] = useState('');

  const isConfigured = settings?.isConfigured ?? false;

  const handleSave = async () => {
    try {
      await saveWebhookUrl(webhookUrl);
      setWebhookUrl('');
      enqueueSuccessSnackBar({ message: t`Webhook saved` });
    } catch (error) {
      enqueueErrorSnackBar({
        message:
          error instanceof Error ? error.message : t`Could not save webhook`,
      });
    }
  };

  const handleTest = async () => {
    const result = await sendTest();

    if (result.success) {
      enqueueSuccessSnackBar({ message: t`Test notification sent` });
    } else {
      enqueueErrorSnackBar({
        message: result.error ?? t`Could not send test notification`,
      });
    }
  };

  const handleRemove = async () => {
    try {
      await removeWebhookUrl();
      enqueueSuccessSnackBar({ message: t`Webhook removed` });
    } catch {
      enqueueErrorSnackBar({ message: t`Could not remove webhook` });
    }
  };

  return (
    <SubMenuTopBarContainer
      title={t`Notifications`}
      links={[
        {
          children: <Trans>User</Trans>,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: <Trans>Notifications</Trans> },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title
            title={t`Google Chat`}
            description={t`Get your personal CRM alerts (leads routed to you, replies, tasks) in a private Google Chat space.`}
          />
          <StyledInstructions>
            <li>
              <Trans>
                In Google Chat, create a new space just for yourself.
              </Trans>
            </li>
            <li>
              <Trans>
                Open the space, add an app, and choose "Incoming Webhook".
              </Trans>
            </li>
            <li>
              <Trans>Name it "ENSO CRM" and copy the webhook URL.</Trans>
            </li>
            <li>
              <Trans>Paste it below and save.</Trans>
            </li>
          </StyledInstructions>
          {isConfigured && (
            <StyledStatus>
              <IconCheck size={16} />
              <Trans>Connected — {settings?.maskedWebhookUrl ?? ''}</Trans>
            </StyledStatus>
          )}
          <SettingsTextInput
            instanceId="google-chat-webhook-url"
            value={webhookUrl}
            onChange={setWebhookUrl}
            placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…"
            fullWidth
          />
          <StyledButtonRow>
            <Button
              title={isConfigured ? t`Replace webhook` : t`Save webhook`}
              variant="primary"
              accent="blue"
              onClick={handleSave}
              disabled={isSaving || webhookUrl.trim().length === 0}
            />
            <Button
              title={t`Send test`}
              variant="secondary"
              onClick={handleTest}
              disabled={!isConfigured || isTesting}
            />
            {isConfigured && (
              <Button
                title={t`Remove`}
                variant="secondary"
                accent="danger"
                onClick={handleRemove}
                disabled={isRemoving}
              />
            )}
          </StyledButtonRow>
        </Section>
      </SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
