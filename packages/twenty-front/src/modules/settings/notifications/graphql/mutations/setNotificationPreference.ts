import gql from 'graphql-tag';

export const SET_NOTIFICATION_PREFERENCE = gql`
  mutation SetNotificationPreference($event: String!, $enabled: Boolean!) {
    setNotificationPreference(event: $event, enabled: $enabled) {
      event
      enabled
    }
  }
`;
