import gql from 'graphql-tag';

export const GOOGLE_CHAT_WEBHOOK_SETTINGS = gql`
  query GoogleChatWebhookSettings {
    googleChatWebhookSettings {
      isConfigured
      maskedWebhookUrl
    }
  }
`;
