import gql from 'graphql-tag';

export const DELETE_GOOGLE_CHAT_WEBHOOK_URL = gql`
  mutation DeleteGoogleChatWebhookUrl {
    deleteGoogleChatWebhookUrl
  }
`;
