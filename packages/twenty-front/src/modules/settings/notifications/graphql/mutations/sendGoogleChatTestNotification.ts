import gql from 'graphql-tag';

export const SEND_GOOGLE_CHAT_TEST_NOTIFICATION = gql`
  mutation SendGoogleChatTestNotification {
    sendGoogleChatTestNotification {
      success
      error
    }
  }
`;
