import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { ObjectMetadataIcon } from '@/object-metadata/components/ObjectMetadataIcon';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import {
  IconArrowMerge,
  IconCirclePlus,
  IconEditCircle,
  IconRestore,
  IconTrash,
} from 'twenty-ui/display';

export const EventIconDynamicComponent = ({
  event,
  linkedObjectMetadataItem,
}: {
  event: TimelineActivity;
  linkedObjectMetadataItem: EnrichedObjectMetadataItem | null;
}) => {
  const [, eventAction] = event.name.split('.');

  if (eventAction === 'created') {
    return <IconCirclePlus />;
  }
  if (eventAction === 'updated') {
    return <IconEditCircle />;
  }
  if (eventAction === 'deleted') {
    return <IconTrash />;
  }
  if (eventAction === 'restored') {
    return <IconRestore />;
  }
  // ENSO — duplicates merged (enso-record.merged).
  if (eventAction === 'merged') {
    return <IconArrowMerge />;
  }

  return <ObjectMetadataIcon objectMetadataItem={linkedObjectMetadataItem} />;
};
