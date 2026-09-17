import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { Avatar, Label, SidePanelInformationBanner } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useEnsoLeadProfile } from '@/enso/lead-lookup/hooks/useEnsoLeadProfile';
import { ensoLeadProfileSubjectComponentState } from '@/enso/lead-lookup/states/ensoLeadProfileSubjectComponentState';
import {
  formatActivityLine,
  formatDealLine,
  formatProfileDate,
  formatProjectHeading,
  formatSourceLine,
} from '@/enso/lead-lookup/utils/formatEnsoLeadProfile';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledIdentity = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledIdentityText = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
`;

const StyledName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMuted = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: space-between;
`;

const StyledRowLabel = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  flex-shrink: 0;
  font-size: ${themeCssVariables.font.size.md};
`;

const StyledRowValue = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  overflow-wrap: anywhere;
  text-align: right;
`;

const StyledFootnote = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.4;
`;

type ProfileRowProps = { label: string; value: string | null | undefined };

const ProfileRow = ({ label, value }: ProfileRowProps) =>
  isNonEmptyString(value) ? (
    <StyledRow>
      <StyledRowLabel>{label}</StyledRowLabel>
      <StyledRowValue>{value}</StyledRowValue>
    </StyledRow>
  ) : null;

// The read-only view of a lead somebody else is working.
//
// A scoped manager cannot open the record — that is the point of the scoping —
// but they can open this: who has it, how far along they are, where it came
// from, and how much conversation there has already been. Nothing here is
// editable and nothing here is a record, so there is no path from this panel
// back into somebody else's book.
export const SidePanelEnsoLeadProfilePage = () => {
  const { t } = useLingui();
  const ensoLeadProfileSubject = useAtomComponentStateValue(
    ensoLeadProfileSubjectComponentState,
  );
  const { profile, loading } = useEnsoLeadProfile(ensoLeadProfileSubject);

  if (loading || !isDefined(profile)) {
    return null;
  }

  if (!profile.isFound) {
    return (
      <StyledContainer>
        <SidePanelInformationBanner
          message={t`This lead is no longer in the CRM.`}
        />
      </StyledContainer>
    );
  }

  const owners = [
    ...new Set(
      profile.projects
        .map((project) => project.ownerName)
        .filter(isNonEmptyString),
    ),
  ];

  const bannerMessage = profile.isMine
    ? t`Read only. This lead is yours — open its record from your own list to work it.`
    : owners.length > 0
      ? t`Read only. This lead is worked by ${owners.join(', ')}.`
      : t`Read only. Nobody is working this lead yet.`;

  const identityLine = [profile.maskedPhone, profile.maskedEmail]
    .filter(isNonEmptyString)
    .join(' · ');

  const inboundLine = formatActivityLine(
    profile.activity.inboundCount,
    profile.activity.lastInboundAt,
  );
  const outboundLine = formatActivityLine(
    profile.activity.outboundCount,
    profile.activity.lastOutboundAt,
  );

  return (
    <StyledContainer>
      <StyledIdentity>
        <Avatar
          type="rounded"
          size="xl"
          placeholderColorSeed={profile.personId ?? profile.displayName}
          placeholder={profile.displayName}
        />
        <StyledIdentityText>
          <StyledName>{profile.displayName}</StyledName>
          {isNonEmptyString(identityLine) && (
            <StyledMuted>{identityLine}</StyledMuted>
          )}
        </StyledIdentityText>
      </StyledIdentity>

      <SidePanelInformationBanner message={bannerMessage} />

      {profile.projects.map((project) => (
        <StyledSection key={project.projectId ?? formatProjectHeading(project)}>
          <Label>{formatProjectHeading(project)}</Label>
          <ProfileRow
            label={t`Owner`}
            value={project.ownerName ?? t`Unassigned`}
          />
          <ProfileRow label={t`Reach them at`} value={project.ownerEmail} />
          <ProfileRow label={t`Deal`} value={formatDealLine(project)} />
          <ProfileRow
            label={t`First contact`}
            value={formatProfileDate(project.firstContactAt)}
          />
          <ProfileRow
            label={t`Last touch`}
            value={formatProfileDate(project.lastTouchAt)}
          />
          <ProfileRow label={t`Source`} value={formatSourceLine(project)} />
          {project.reengagementCount > 0 && (
            <ProfileRow
              label={t`Came back`}
              value={t`${project.reengagementCount} times`}
            />
          )}
        </StyledSection>
      ))}

      <StyledSection>
        <Label>{t`Conversation`}</Label>
        <ProfileRow
          label={t`First seen`}
          value={formatProfileDate(profile.firstTouchAt)}
        />
        <ProfileRow label={t`Inbound`} value={inboundLine ?? t`None`} />
        <ProfileRow label={t`Outbound`} value={outboundLine ?? t`None`} />
      </StyledSection>

      <StyledFootnote>
        {t`Contact details stay with the owner. If you need this lead, talk to them first.`}
      </StyledFootnote>
    </StyledContainer>
  );
};
