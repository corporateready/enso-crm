import { styled } from '@linaria/react';
import { Fragment } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type MentionableMember } from '@/page-layout/widgets/deal-comments/types/MentionableMember';
import { splitCommentIntoMentionParts } from '@/page-layout/widgets/deal-comments/utils/splitCommentIntoMentionParts';

const StyledBody = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const StyledMention = styled.span`
  color: ${themeCssVariables.color.blue};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

type DealCommentBodyProps = {
  body: string;
  members: MentionableMember[];
};

export const DealCommentBody = ({ body, members }: DealCommentBodyProps) => (
  <StyledBody>
    {splitCommentIntoMentionParts(
      body,
      members.map((member) => member.name),
    ).map((part, index) =>
      part.isMention ? (
        <StyledMention key={index}>{part.text}</StyledMention>
      ) : (
        <Fragment key={index}>{part.text}</Fragment>
      ),
    )}
  </StyledBody>
);
