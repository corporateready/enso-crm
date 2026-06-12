import { styled } from '@linaria/react';
import { useState } from 'react';

import { isDefined } from 'twenty-shared/utils';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledTextArea = styled.textarea`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 56px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;
`;

const StyledRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

// Manual activity logging: the manager records what they did on this touch
// (notes + outcome). We create an outboundActivity (the record of the touch,
// symmetric to inboundActivity) and set the task outcome — which the scanner
// reacts to. The outcome value also chooses how the touch is logged.
const TOUCH_OUTCOMES: { value: string; label: string }[] = [
  { value: 'REACHED', label: 'Reached' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'NOT_INTERESTED', label: 'Not interested' },
];

type TaskActionsWidgetProps = {
  widget: PageLayoutWidget;
};

export const TaskActionsWidget = ({
  widget: _widget,
}: TaskActionsWidgetProps) => {
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const taskId = targetRecordIdentifier?.id;

  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord: createOutboundActivity } = useCreateOneRecord({
    objectNameSingular: 'outboundActivity',
  });
  const { record: task } = useFindOneRecord({
    objectNameSingular: 'task',
    objectRecordId: taskId,
    skip: !isDefined(taskId),
  });

  const [notes, setNotes] = useState('');

  const handleLog = async (outcome: string) => {
    if (!isDefined(taskId)) {
      return;
    }

    const channel = task?.channel ?? null;
    const opportunityId = task?.sequenceRun?.opportunityId ?? null;

    await createOutboundActivity({
      channel,
      loggedVia: 'MANUAL_LOG',
      body: notes,
      occurredAt: new Date().toISOString(),
      taskId,
      ...(isDefined(opportunityId) ? { opportunityId } : {}),
      ...(isDefined(currentWorkspaceMember?.id)
        ? { performedById: currentWorkspaceMember.id }
        : {}),
    });

    await updateOneRecord({
      objectNameSingular: 'task',
      idToUpdate: taskId,
      updateOneRecordInput: { outcome, status: 'DONE' },
    });

    setNotes('');
  };

  return (
    <StyledContainer>
      <StyledLabel>Log what happened on this touch</StyledLabel>
      <StyledTextArea
        placeholder="Notes (what you said, what they wanted)…"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <StyledRow>
        {TOUCH_OUTCOMES.map((outcomeOption) => (
          <Button
            key={outcomeOption.value}
            title={outcomeOption.label}
            variant="secondary"
            onClick={() => handleLog(outcomeOption.value)}
          />
        ))}
      </StyledRow>
    </StyledContainer>
  );
};
