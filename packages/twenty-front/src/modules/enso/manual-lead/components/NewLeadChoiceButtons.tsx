import { styled } from '@linaria/react';

import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

type NewLeadChoiceButtonsProps<TValue extends string> = {
  options: { label: string; value: TValue }[];
  value: TValue;
  onChange: (value: TValue) => void;
};

// A small segmented choice: the picked option is filled, the others outlined.
export const NewLeadChoiceButtons = <TValue extends string>({
  options,
  value,
  onChange,
}: NewLeadChoiceButtonsProps<TValue>) => (
  <StyledRow>
    {options.map((option) => (
      <Button
        key={option.value}
        title={option.label}
        size="small"
        variant={option.value === value ? 'primary' : 'secondary'}
        accent={option.value === value ? 'blue' : 'default'}
        onClick={() => onChange(option.value)}
      />
    ))}
  </StyledRow>
);
