import { useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { DealCommentBody } from '@/page-layout/widgets/deal-comments/components/DealCommentBody';
import { DealCommentComposer } from '@/page-layout/widgets/deal-comments/components/DealCommentComposer';
import {
  CREATE_DEAL_COMMENT,
  DELETE_DEAL_COMMENT,
} from '@/page-layout/widgets/deal-comments/graphql/dealCommentMutations';
import { type MentionableMember } from '@/page-layout/widgets/deal-comments/types/MentionableMember';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useLayoutRenderingContext } from '@/ui/layout/contexts/LayoutRenderingContext';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

// ENSO sentinel for the deal's Comments tab — internal discussion between
// colleagues, separate from notes (which record something about the client).
export const ENSO_DEAL_COMMENTS_MARKER = '__enso_deal_comments';

type DealCommentResult = {
  success: boolean;
  error?: string | null;
  commentId?: string | null;
};

const COMMENT_GQL_FIELDS = {
  id: true,
  body: true,
  createdAt: true,
  createdBy: true,
};

const MEMBER_GQL_FIELDS = {
  id: true,
  name: true,
};

const formatDateTime = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
};

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[2]};
  width: 100%;

  & * {
    box-sizing: border-box;
  }
`;

const StyledThread = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledComment = styled.div`
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledHead = styled.div`
  align-items: baseline;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledAuthor = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledDate = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledDelete = styled.button`
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.xs};
  padding: 0;

  &:hover {
    color: ${themeCssVariables.font.color.danger};
  }
`;

export const DealCommentsWidget = () => {
  const { t } = useLingui();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { targetRecordIdentifier } = useLayoutRenderingContext();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const opportunityId = targetRecordIdentifier?.id;
  const isOpportunity =
    targetRecordIdentifier?.targetObjectNameSingular === 'opportunity';

  const {
    records: comments = [],
    loading,
    refetch,
  } = useFindManyRecords({
    objectNameSingular: 'dealComment',
    filter: { opportunityId: { eq: opportunityId } },
    orderBy: [{ createdAt: 'AscNullsLast' }],
    recordGqlFields: COMMENT_GQL_FIELDS,
    skip: !isDefined(opportunityId) || !isOpportunity,
    limit: 200,
  });

  const { records: memberRecords = [] } = useFindManyRecords({
    objectNameSingular: 'workspaceMember',
    recordGqlFields: MEMBER_GQL_FIELDS,
    limit: 500,
  });

  const allMembers = useMemo<MentionableMember[]>(
    () =>
      memberRecords
        .map((member) => {
          const name = member.name as
            | { firstName?: string; lastName?: string }
            | undefined;

          return {
            id: member.id as string,
            name: `${name?.firstName ?? ''} ${name?.lastName ?? ''}`.trim(),
          };
        })
        .filter((member) => member.name !== '')
        .sort((first, second) => first.name.localeCompare(second.name)),
    [memberRecords],
  );

  // You can't address a comment to yourself.
  const mentionableMembers = allMembers.filter(
    (member) => member.id !== currentWorkspaceMember?.id,
  );

  const [createDealComment, { loading: isSending }] = useMutation<{
    createDealComment: DealCommentResult;
  }>(CREATE_DEAL_COMMENT);
  const [deleteDealComment] = useMutation<{
    deleteDealComment: DealCommentResult;
  }>(DELETE_DEAL_COMMENT);

  if (!isOpportunity || !isDefined(opportunityId)) {
    return null;
  }

  const handleSend = async (
    body: string,
    mentionedWorkspaceMemberIds: string[],
  ): Promise<boolean> => {
    const result = await createDealComment({
      variables: { opportunityId, body, mentionedWorkspaceMemberIds },
    }).catch(() => undefined);
    const outcome = result?.data?.createDealComment;

    if (outcome?.success !== true) {
      enqueueErrorSnackBar({
        message: outcome?.error ?? t`Could not post the comment.`,
      });

      return false;
    }

    await refetch();

    return true;
  };

  const handleDelete = async (commentId: string) => {
    const result = await deleteDealComment({
      variables: { commentId },
    }).catch(() => undefined);
    const outcome = result?.data?.deleteDealComment;

    if (outcome?.success !== true) {
      enqueueErrorSnackBar({
        message: outcome?.error ?? t`Could not delete the comment.`,
      });

      return;
    }

    await refetch();
  };

  return (
    <StyledContainer>
      <StyledThread>
        {loading && comments.length === 0 && (
          <StyledHint>{t`Loading…`}</StyledHint>
        )}
        {!loading && comments.length === 0 && (
          <StyledHint>
            {t`No comments yet. Ask a colleague something about this deal — they'll get a Google Chat message.`}
          </StyledHint>
        )}
        {comments.map((comment) => {
          const author = comment.createdBy as
            | { name?: string; workspaceMemberId?: string | null }
            | null
            | undefined;
          const isMine =
            isDefined(currentWorkspaceMember?.id) &&
            author?.workspaceMemberId === currentWorkspaceMember.id;

          return (
            <StyledComment key={comment.id as string}>
              <StyledHead>
                <StyledAuthor>{author?.name ?? t`Unknown`}</StyledAuthor>
                <StyledDate>{formatDateTime(comment.createdAt)}</StyledDate>
                {isMine && (
                  <StyledDelete
                    type="button"
                    onClick={() => void handleDelete(comment.id as string)}
                  >
                    {t`Delete`}
                  </StyledDelete>
                )}
              </StyledHead>
              <DealCommentBody
                body={(comment.body as string) ?? ''}
                members={allMembers}
              />
            </StyledComment>
          );
        })}
      </StyledThread>
      <DealCommentComposer
        members={mentionableMembers}
        isSending={isSending}
        onSend={handleSend}
      />
    </StyledContainer>
  );
};
