import gql from 'graphql-tag';

export const NOTIFICATION_PREFERENCES = gql`
  query NotificationPreferences {
    notificationPreferences {
      event
      enabled
    }
  }
`;
