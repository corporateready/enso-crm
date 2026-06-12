import gql from 'graphql-tag';

export const SET_GOOGLE_CHAT_WEBHOOK_URL = gql`
  mutation SetGoogleChatWebhookUrl($input: SetGoogleChatWebhookUrlInput!) {
    setGoogleChatWebhookUrl(input: $input) {
      isConfigured
      maskedWebhookUrl
    }
  }
`;
