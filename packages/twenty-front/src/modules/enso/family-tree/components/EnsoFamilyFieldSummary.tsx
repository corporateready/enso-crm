import { plural } from '@lingui/core/macro';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledSummary = styled.span`
  color: ${themeCssVariables.font.color.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

type EnsoFamilyFieldSummaryProps = {
  relativeCount: number;
};

// A row of relation chips truncates after the first one, which hid most of a
// person's relatives. A count reads at a glance; the Family tab shows who.
export const EnsoFamilyFieldSummary = ({
  relativeCount,
}: EnsoFamilyFieldSummaryProps) => (
  <StyledSummary>
    {plural(relativeCount, { one: '# relative', other: '# relatives' })}
  </StyledSummary>
);
