import gql from 'graphql-tag';

// The only way to write a deal comment; the generic record API rejects it so
// the "mention someone" rule can't be skipped.
export const CREATE_DEAL_COMMENT = gql`
  mutation CreateDealComment(
    $opportunityId: String!
    $body: String!
    $mentionedWorkspaceMemberIds: [String!]!
  ) {
    createDealComment(
      opportunityId: $opportunityId
      body: $body
      mentionedWorkspaceMemberIds: $mentionedWorkspaceMemberIds
    ) {
      success
      error
      commentId
    }
  }
`;

export const DELETE_DEAL_COMMENT = gql`
  mutation DeleteDealComment($commentId: String!) {
    deleteDealComment(commentId: $commentId) {
      success
      error
      commentId
    }
  }
`;
