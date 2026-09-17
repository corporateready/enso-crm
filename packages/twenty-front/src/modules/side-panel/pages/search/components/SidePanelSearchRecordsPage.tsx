import { useCloseCommandMenu } from '@/command-menu-item/hooks/useCloseCommandMenu';
import { CommandMenuItem } from '@/command-menu/components/CommandMenuItem';
import { useEnsoLeadLookup } from '@/enso/lead-lookup/hooks/useEnsoLeadLookup';
import { useOpenEnsoLeadProfileInSidePanel } from '@/enso/lead-lookup/hooks/useOpenEnsoLeadProfileInSidePanel';
import {
  formatEnsoLeadLookupDealSummary,
  formatEnsoLeadLookupSummary,
} from '@/enso/lead-lookup/utils/formatEnsoLeadLookupMatch';
import { sidePanelSearchState } from '@/side-panel/states/sidePanelSearchState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { SidePanelGroup } from '@/side-panel/components/SidePanelGroup';
import { SidePanelList } from '@/side-panel/components/SidePanelList';
import { useSidePanelSearchRecords } from '@/side-panel/pages/search/hooks/useSidePanelSearchRecords';
import { SelectableListItem } from '@/ui/layout/selectable-list/components/SelectableListItem';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CoreObjectNameSingular, AppPath } from 'twenty-shared/types';
import { getAppPath } from 'twenty-shared/utils';
import { Avatar } from 'twenty-ui/display';
import { useLingui } from '@lingui/react/macro';

export const SidePanelSearchRecordsPage = () => {
  const { t } = useLingui();
  const { searchResultItems, loading, noResults } = useSidePanelSearchRecords();
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const { closeCommandMenu } = useCloseCommandMenu();
  const navigate = useNavigate();

  // Managers who only see their own records still need to know whether a
  // contact is already being worked by a colleague — otherwise the honest
  // answer "no results" quietly invites a duplicate, or a poached lead.
  const sidePanelSearch = useAtomStateValue(sidePanelSearchState);
  const { foreignMatches, foreignDealMatches, isRateLimited } =
    useEnsoLeadLookup(sidePanelSearch);
  const { openEnsoLeadProfileInSidePanel } =
    useOpenEnsoLeadProfileInSidePanel();

  const selectableItemIds = useMemo(
    () => searchResultItems.map((item) => item.id),
    [searchResultItems],
  );

  return (
    <SidePanelList
      selectableItemIds={selectableItemIds}
      loading={loading}
      noResults={
        noResults &&
        foreignMatches.length === 0 &&
        foreignDealMatches.length === 0 &&
        !isRateLimited
      }
    >
      {searchResultItems.length > 0 && (
        <SidePanelGroup heading={t`Results`}>
          {searchResultItems.map((item) => {
            const isTaskOrNote = [
              CoreObjectNameSingular.Task,
              CoreObjectNameSingular.Note,
            ].includes(item.objectNameSingular as CoreObjectNameSingular);

            const handleClick = () => {
              if (isTaskOrNote) {
                openRecordInSidePanel({
                  recordId: item.recordId,
                  objectNameSingular:
                    item.objectNameSingular as CoreObjectNameSingular,
                });
              } else {
                closeCommandMenu();
                navigate(
                  getAppPath(AppPath.RecordShowPage, {
                    objectNameSingular: item.objectNameSingular,
                    objectRecordId: item.recordId,
                  }),
                );
              }
            };

            return (
              <SelectableListItem
                key={item.id}
                itemId={item.id}
                onEnter={handleClick}
              >
                <CommandMenuItem
                  id={item.id}
                  label={item.label}
                  description={item.objectLabel}
                  onClick={handleClick}
                  LeftComponent={
                    <Avatar
                      type={item.avatarType}
                      avatarUrl={item.imageUrl}
                      placeholderColorSeed={item.recordId}
                      placeholder={item.label}
                    />
                  }
                />
              </SelectableListItem>
            );
          })}
        </SidePanelGroup>
      )}
      {isRateLimited && (
        <SidePanelGroup heading={t`Elsewhere in the CRM`}>
          <CommandMenuItem
            id="enso-lead-lookup-rate-limited"
            label={t`Daily lookup limit reached`}
            description={t`Cross-team contact lookups reset tomorrow. Ask an admin if you need more.`}
            disabled
          />
        </SidePanelGroup>
      )}
      {(foreignMatches.length > 0 || foreignDealMatches.length > 0) && (
        <SidePanelGroup heading={t`Elsewhere in the CRM`}>
          {foreignMatches.map((match) => (
            <CommandMenuItem
              key={match.personId}
              id={match.personId}
              label={match.displayName}
              description={formatEnsoLeadLookupSummary(match)}
              // Opens the read-only profile, not the record: a scoped manager
              // still cannot see somebody else's contact details.
              onClick={() =>
                openEnsoLeadProfileInSidePanel(
                  { personId: match.personId, opportunityId: null },
                  match.displayName,
                )
              }
              LeftComponent={
                <Avatar
                  type="rounded"
                  placeholderColorSeed={match.personId}
                  placeholder={match.displayName}
                />
              }
            />
          ))}
          {foreignDealMatches.map((match) => (
            <CommandMenuItem
              key={match.opportunityId}
              id={match.opportunityId}
              label={`${match.dealLabel} · ${match.displayName}`}
              description={formatEnsoLeadLookupDealSummary(match)}
              onClick={() =>
                openEnsoLeadProfileInSidePanel(
                  {
                    personId: match.personId,
                    opportunityId: match.opportunityId,
                  },
                  match.displayName,
                )
              }
              LeftComponent={
                <Avatar
                  type="squared"
                  placeholderColorSeed={match.opportunityId}
                  placeholder={match.dealLabel}
                />
              }
            />
          ))}
        </SidePanelGroup>
      )}
    </SidePanelList>
  );
};
