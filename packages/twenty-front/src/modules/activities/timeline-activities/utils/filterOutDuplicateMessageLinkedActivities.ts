import { isDefined } from 'twenty-shared/utils';

import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';

// A manager-sent 1:1 email produces BOTH a native "linked an email"
// (message.linked) row AND our clean enso "Sent an email" row. The enso event is
// keyed to the same message (linkedRecordId = messageId) so we can hide the
// native duplicate here, leaving one unified line per touch. Inbound/synced
// emails have no matching enso event, so their message.linked rows are kept.
const ENSO_EMAIL_SENT_ACTIVITY_NAME = 'enso-event.email-sent';
const MESSAGE_LINKED_ACTIVITY_NAME = 'message.linked';

export const filterOutDuplicateMessageLinkedActivities = (
  timelineActivities: TimelineActivity[],
): TimelineActivity[] => {
  const supersededMessageIds = new Set(
    timelineActivities
      .filter(
        (activity) =>
          activity.name === ENSO_EMAIL_SENT_ACTIVITY_NAME &&
          isDefined(activity.linkedRecordId),
      )
      .map((activity) => activity.linkedRecordId),
  );

  if (supersededMessageIds.size === 0) {
    return timelineActivities;
  }

  return timelineActivities.filter(
    (activity) =>
      !(
        activity.name === MESSAGE_LINKED_ACTIVITY_NAME &&
        isDefined(activity.linkedRecordId) &&
        supersededMessageIds.has(activity.linkedRecordId)
      ),
  );
};
