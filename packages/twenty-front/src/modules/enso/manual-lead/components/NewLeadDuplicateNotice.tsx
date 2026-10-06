import { styled } from '@linaria/react';

import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type NewLeadDuplicateCheck } from '@/enso/manual-lead/types/NewLeadFormValues';

const StyledNotice = styled.div<{ tone: 'info' | 'danger' }>`
  background: ${({ tone }) =>
    tone === 'danger'
      ? themeCssVariables.background.transparent.danger
      : themeCssVariables.background.transparent.blue};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.4;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const describeMatch = (check: NewLeadDuplicateCheck) =>
  [check.displayName, check.maskedPhone, check.maskedEmail]
    .filter(isDefined)
    .join(' · ');

type NewLeadDuplicateNoticeProps = {
  check: NewLeadDuplicateCheck | null;
};

// What adding the lead will do to the contacts already in the CRM, said before
// the manager commits to it.
export const NewLeadDuplicateNotice = ({
  check,
}: NewLeadDuplicateNoticeProps) => {
  if (!isDefined(check) || check.verdict === 'NEW') {
    return null;
  }

  if (check.isRateLimited) {
    return (
      <StyledNotice tone="info">
        You have checked a lot of contacts today, so this one was not checked.
        It is still checked when you add the lead.
      </StyledNotice>
    );
  }

  if (check.verdict === 'BLOCKED') {
    return (
      <StyledNotice tone="danger">
        {describeMatch(check)} is already {check.ownerName ?? 'a colleague'}
        ’s client on this project, so you can’t add them again. Talk to{' '}
        {check.ownerName ?? 'them'} first.
      </StyledNotice>
    );
  }

  return (
    <StyledNotice tone="info">
      Already in the CRM: {describeMatch(check)}.{' '}
      {check.hasOpenDeal
        ? 'The lead will be added to their open deal on this project.'
        : 'The lead will be added to this contact instead of a new one.'}
    </StyledNotice>
  );
};
