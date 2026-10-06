import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type MentionableMember } from '@/page-layout/widgets/deal-comments/types/MentionableMember';
import {
  filterMentionableMembers,
  findActiveMentionQuery,
  getMentionedMemberIds,
  insertMention,
} from '@/page-layout/widgets/deal-comments/utils/dealCommentMentions';
import { usePushFocusItemToFocusStack } from '@/ui/utilities/focus/hooks/usePushFocusItemToFocusStack';
import { useRemoveFocusItemFromFocusStackById } from '@/ui/utilities/focus/hooks/useRemoveFocusItemFromFocusStackById';
import { FocusComponentType } from '@/ui/utilities/focus/types/FocusComponentType';

const MAX_SUGGESTIONS = 6;

const StyledComposer = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
  position: relative;
`;

const StyledTextArea = styled.textarea`
  background: transparent;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 60px;
  outline: none;
  resize: vertical;
  width: 100%;

  &::placeholder {
    color: ${themeCssVariables.font.color.light};
  }
`;

const StyledFooter = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSuggestions = styled.div`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  bottom: 100%;
  box-shadow: ${themeCssVariables.boxShadow.strong};
  display: flex;
  flex-direction: column;
  left: ${themeCssVariables.spacing[2]};
  margin-bottom: ${themeCssVariables.spacing[1]};
  min-width: 220px;
  padding: ${themeCssVariables.spacing[1]};
  position: absolute;
  z-index: 10;
`;

const StyledSuggestion = styled.button<{ $isHighlighted: boolean }>`
  background: ${({ $isHighlighted }) =>
    $isHighlighted
      ? themeCssVariables.background.transparent.light
      : 'transparent'};
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
  text-align: left;
`;

type DealCommentComposerProps = {
  members: MentionableMember[];
  isSending: boolean;
  onSend: (
    body: string,
    mentionedWorkspaceMemberIds: string[],
  ) => Promise<boolean>;
};

// A manager's own summary or thoughts, or a question to a colleague. Tagging
// is optional: typing @ opens the picker, and only tagged colleagues are
// notified. Deleting an inserted @name takes that mention back.
export const DealCommentComposer = ({
  members,
  isSending,
  onSend,
}: DealCommentComposerProps) => {
  const { t } = useLingui();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const focusId = `deal-comment-composer-${useId()}`;
  const { pushFocusItemToFocusStack } = usePushFocusItemToFocusStack();
  const { removeFocusItemFromFocusStackById } =
    useRemoveFocusItemFromFocusStackById();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pickedMembers, setPickedMembers] = useState<MentionableMember[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isPickerDismissed, setIsPickerDismissed] = useState(false);

  const activeQuery = findActiveMentionQuery(text, caret);
  const suggestions =
    activeQuery === null || isPickerDismissed
      ? []
      : filterMentionableMembers(members, activeQuery.query).slice(
          0,
          MAX_SUGGESTIONS,
        );
  const mentionedIds = getMentionedMemberIds(text, pickedMembers);
  const canSend = text.trim() !== '' && !isSending;

  const updateText = (nextText: string, nextCaret: number) => {
    setText(nextText);
    setCaret(nextCaret);
    setHighlightedIndex(0);
    setIsPickerDismissed(false);
  };

  const pickMember = (member: MentionableMember) => {
    if (activeQuery === null) {
      return;
    }

    const next = insertMention({
      text,
      start: activeQuery.start,
      caret,
      member,
    });

    updateText(next.text, next.caret);
    setPickedMembers((previous) =>
      previous.some((picked) => picked.id === member.id)
        ? previous
        : [...previous, member],
    );

    requestAnimationFrame(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = async () => {
    if (!canSend) {
      return;
    }

    const isSent = await onSend(text, mentionedIds);

    if (isSent) {
      updateText('', 0);
      setPickedMembers([]);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;

        setHighlightedIndex(
          (previous) =>
            (previous + step + suggestions.length) % suggestions.length,
        );

        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickMember(suggestions[highlightedIndex] ?? suggestions[0]);

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsPickerDismissed(true);

        return;
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <StyledComposer>
      {suggestions.length > 0 && (
        <StyledSuggestions>
          {suggestions.map((member, index) => (
            <StyledSuggestion
              key={member.id}
              type="button"
              $isHighlighted={index === highlightedIndex}
              onMouseDown={(event) => {
                // Keep focus in the text area so the caret survives the click.
                event.preventDefault();
                pickMember(member);
              }}
            >
              {member.name}
            </StyledSuggestion>
          ))}
        </StyledSuggestions>
      )}
      <StyledTextArea
        ref={textAreaRef}
        value={text}
        placeholder={t`Write a summary or a thought, or @tag a colleague…`}
        onChange={(event) =>
          updateText(event.target.value, event.target.selectionStart)
        }
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        // A plain textarea is invisible to the app's hotkey system, so typing
        // "g" then "o" would fire the go-to-Opportunities shortcut mid-comment.
        // Registering focus the way TextArea does turns those off while typing.
        onFocus={() =>
          pushFocusItemToFocusStack({
            focusId,
            component: {
              type: FocusComponentType.TEXT_AREA,
              instanceId: focusId,
            },
            globalHotkeysConfig: {
              enableGlobalHotkeysConflictingWithKeyboard: false,
            },
          })
        }
        onBlur={() => removeFocusItemFromFocusStackById({ focusId })}
      />
      <StyledFooter>
        <StyledHint>
          {mentionedIds.length > 0
            ? t`Tagged colleagues are notified. ⌘/Ctrl + Enter to send.`
            : t`Tag a colleague with @ to notify them. ⌘/Ctrl + Enter to send.`}
        </StyledHint>
        <Button
          title={isSending ? t`Sending…` : t`Send`}
          variant="primary"
          accent="blue"
          size="small"
          disabled={!canSend}
          onClick={() => void send()}
        />
      </StyledFooter>
    </StyledComposer>
  );
};
