import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { isNonEmptyString } from '@sniptt/guards';
import { useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import {
  FAMILY_NODE_HEIGHT,
  FAMILY_NODE_WIDTH,
} from '@/enso/family-tree/utils/layoutFamilyGraph';

const StyledCard = styled.div<{ $isFocus: boolean }>`
  background: ${({ $isFocus }) =>
    $isFocus
      ? themeCssVariables.background.tertiary
      : themeCssVariables.background.primary};
  border: 1px solid
    ${({ $isFocus }) =>
      $isFocus
        ? themeCssVariables.border.color.strong
        : themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  position: absolute;

  &:hover .family-card-menu-button {
    visibility: visible;
  }
`;

const StyledBody = styled.button<{ $isFocus: boolean }>`
  align-items: center;
  background: none;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  cursor: ${({ $isFocus }) => ($isFocus ? 'default' : 'pointer')};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  height: 100%;
  justify-content: center;
  padding: 0 ${themeCssVariables.spacing[5]};
  width: 100%;
`;

const StyledName = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledRelation = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledMenuButton = styled.button`
  background: none;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.md};
  line-height: 1;
  padding: 2px 4px;
  position: absolute;
  right: 2px;
  top: 2px;
  visibility: hidden;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

const StyledMenu = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.light};
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: ${themeCssVariables.spacing[1]};
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 2;
`;

const StyledMenuItem = styled.button<{ $isDanger?: boolean }>`
  background: none;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${({ $isDanger }) =>
    $isDanger
      ? themeCssVariables.color.red
      : themeCssVariables.font.color.primary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  text-align: left;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

type FamilyTreeCardProps = {
  name: string;
  relation: string;
  x: number;
  y: number;
  isFocus: boolean;
  // Only a relative linked directly to the person in focus can have that
  // link changed or removed from here.
  canEditLink: boolean;
  onFocus: () => void;
  onOpenProfile: () => void;
  onChangeRelation: () => void;
  onRemove: () => void;
};

export const FamilyTreeCard = ({
  name,
  relation,
  x,
  y,
  isFocus,
  canEditLink,
  onFocus,
  onOpenProfile,
  onChangeRelation,
  onRemove,
}: FamilyTreeCardProps) => {
  const { t } = useLingui();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  const closeMenu = () => {
    setIsMenuOpen(false);
    setIsConfirmingRemove(false);
  };

  return (
    <StyledCard
      $isFocus={isFocus}
      style={{
        left: x,
        top: y,
        width: FAMILY_NODE_WIDTH,
        height: FAMILY_NODE_HEIGHT,
      }}
      onMouseLeave={closeMenu}
    >
      <StyledBody
        type="button"
        title={name}
        $isFocus={isFocus}
        onClick={isFocus ? undefined : onFocus}
      >
        <StyledName>{name || t`Unknown`}</StyledName>
        {isNonEmptyString(relation) && (
          <StyledRelation>{relation}</StyledRelation>
        )}
      </StyledBody>
      <StyledMenuButton
        type="button"
        className="family-card-menu-button"
        aria-label={t`Actions`}
        onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
      >
        ⋯
      </StyledMenuButton>
      {isMenuOpen && (
        <StyledMenu>
          <StyledMenuItem
            type="button"
            onClick={() => {
              closeMenu();
              onOpenProfile();
            }}
          >
            {t`Open profile`}
          </StyledMenuItem>
          {canEditLink && (
            <>
              <StyledMenuItem
                type="button"
                onClick={() => {
                  closeMenu();
                  onChangeRelation();
                }}
              >
                {t`Change relation`}
              </StyledMenuItem>
              <StyledMenuItem
                type="button"
                $isDanger
                onClick={() => {
                  if (!isConfirmingRemove) {
                    setIsConfirmingRemove(true);
                    return;
                  }
                  closeMenu();
                  onRemove();
                }}
              >
                {isConfirmingRemove
                  ? t`Click again to remove`
                  : t`Remove from family`}
              </StyledMenuItem>
            </>
          )}
        </StyledMenu>
      )}
    </StyledCard>
  );
};
