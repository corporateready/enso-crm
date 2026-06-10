import { EventRowActivity } from '@/activities/timeline-activities/rows/activity/components/EventRowActivity';
import { EventRowCalendarEvent } from '@/activities/timeline-activities/rows/calendar/components/EventRowCalendarEvent';
import { EventRowEnsoConsent } from '@/activities/timeline-activities/rows/enso/components/EventRowEnsoConsent';
import { EventRowEnsoEvent } from '@/activities/timeline-activities/rows/enso/components/EventRowEnsoEvent';
import { EventRowEnsoLinkedRecord } from '@/activities/timeline-activities/rows/enso/components/EventRowEnsoLinkedRecord';
import { EventRowEnsoMerge } from '@/activities/timeline-activities/rows/enso/components/EventRowEnsoMerge';
import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';

// ENSO — person-merge / company-merge "duplicates merged" event. Kept in sync
// with ENSO_RECORD_MERGED_ACTIVITY_NAME on the server. Routed by name (no linked
// record — the duplicate is soft-deleted), before the linked-object switch.
const ENSO_RECORD_MERGED_ACTIVITY_NAME = 'enso-record.merged';
// ENSO — generic automation events (company linking, B2B account deals). Kept in
// sync with ENSO_EVENT_ACTIVITY_NAME_PREFIX on the server.
const ENSO_EVENT_ACTIVITY_NAME_PREFIX = 'enso-event.';
import { EventRowMainObject } from '@/activities/timeline-activities/rows/main-object/components/EventRowMainObject';
import { EventRowMessage } from '@/activities/timeline-activities/rows/message/components/EventRowMessage';
import { CoreObjectNameSingular } from 'twenty-shared/types';

export const EventRowDynamicComponent = ({
  labelIdentifierValue,
  event,
  mainObjectMetadataItem,
  linkedObjectMetadataItem,
  authorFullName,
  createdAt,
}: EventRowDynamicComponentProps) => {
  // ENSO — duplicates merged. Routed by name since there's no linked record.
  if (event.name === ENSO_RECORD_MERGED_ACTIVITY_NAME) {
    return (
      <EventRowEnsoMerge
        labelIdentifierValue={labelIdentifierValue}
        event={event}
        mainObjectMetadataItem={mainObjectMetadataItem}
        linkedObjectMetadataItem={linkedObjectMetadataItem}
        authorFullName={authorFullName}
        createdAt={createdAt}
      />
    );
  }

  // ENSO — generic automation events (company linking, B2B account deals).
  if (event.name?.startsWith(ENSO_EVENT_ACTIVITY_NAME_PREFIX)) {
    return (
      <EventRowEnsoEvent
        labelIdentifierValue={labelIdentifierValue}
        event={event}
        mainObjectMetadataItem={mainObjectMetadataItem}
        linkedObjectMetadataItem={linkedObjectMetadataItem}
        authorFullName={authorFullName}
        createdAt={createdAt}
      />
    );
  }

  switch (linkedObjectMetadataItem?.nameSingular) {
    case 'calendarEvent':
      return (
        <EventRowCalendarEvent
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
        />
      );
    case 'message':
      return (
        <EventRowMessage
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
        />
      );
    case 'task':
      return (
        <EventRowActivity
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          objectNameSingular={CoreObjectNameSingular.Task}
          createdAt={createdAt}
        />
      );
    case 'note':
      return (
        <EventRowActivity
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          objectNameSingular={CoreObjectNameSingular.Note}
          createdAt={createdAt}
        />
      );
    // ENSO — inbound activities + opportunities surfaced on the person's timeline.
    case 'inboundActivity':
    case 'opportunity':
      return (
        <EventRowEnsoLinkedRecord
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          createdAt={createdAt}
        />
      );
    // ENSO — aggregated consent grant/revoke surfaced on the person's timeline.
    case 'personProjectConsentEvent':
      return (
        <EventRowEnsoConsent
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          createdAt={createdAt}
        />
      );
    default:
      return (
        <EventRowMainObject
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          createdAt={createdAt}
        />
      );
  }
};
