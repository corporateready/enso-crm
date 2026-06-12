import { styled } from '@linaria/react';

import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
  width: 100%;
`;

const StyledRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
`;

// v1: log the result of a touch in one click. Setting the task outcome is the
// signal the sequencing scanner reacts to (Reached -> Connected, Not interested
// -> Closed Lost, No answer -> cadence continues). Channel-aware buttons, the
// outboundActivity record, and click-to-call come in later iterations.
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
  const { updateOneRecord } = useUpdateOneRecord();

  const taskId = targetRecordIdentifier?.id;

  const handleOutcome = async (outcome: string) => {
    if (taskId === undefined) {
      return;
    }

    await updateOneRecord({
      objectNameSingular: 'task',
      idToUpdate: taskId,
      updateOneRecordInput: { outcome, status: 'DONE' },
    });
  };

  return (
    <StyledContainer>
      <StyledLabel>Log the result of this touch</StyledLabel>
      <StyledRow>
        {TOUCH_OUTCOMES.map((outcomeOption) => (
          <Button
            key={outcomeOption.value}
            title={outcomeOption.label}
            variant="secondary"
            onClick={() => handleOutcome(outcomeOption.value)}
          />
        ))}
      </StyledRow>
    </StyledContainer>
  );
};
