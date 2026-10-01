import { render, waitFor } from '@testing-library/react';

import { HeadlessEngineCommandWrapperEffect } from '@/command-menu-item/engine-command/components/HeadlessEngineCommandWrapperEffect';

const COMMAND_MENU_ITEM_ID = 'command-menu-item-id';

const mockUnmountCommand = jest.fn();
const mockEnqueueErrorSnackBar = jest.fn();

jest.mock(
  '@/command-menu-item/engine-command/hooks/useUnmountEngineCommand',
  () => ({
    useUnmountCommand: () => mockUnmountCommand,
  }),
);

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
  }),
}));

jest.mock(
  '@/ui/utilities/state/component-state/hooks/useAvailableComponentInstanceIdOrThrow',
  () => ({
    useAvailableComponentInstanceIdOrThrow: () => COMMAND_MENU_ITEM_ID,
  }),
);

describe('HeadlessEngineCommandWrapperEffect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should unmount the command after it succeeds', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);

    render(<HeadlessEngineCommandWrapperEffect execute={execute} />);

    await waitFor(() =>
      expect(mockUnmountCommand).toHaveBeenCalledWith(COMMAND_MENU_ITEM_ID),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockEnqueueErrorSnackBar).not.toHaveBeenCalled();
  });

  // A command left mounted keeps its menu item disabled until the page is
  // reloaded, e.g. "Delete" stays greyed out after one failed delete.
  it('should unmount the command and show an error when it fails', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('Network error'));

    render(<HeadlessEngineCommandWrapperEffect execute={execute} />);

    await waitFor(() =>
      expect(mockUnmountCommand).toHaveBeenCalledWith(COMMAND_MENU_ITEM_ID),
    );
    expect(mockEnqueueErrorSnackBar).toHaveBeenCalledTimes(1);
  });

  it('should not run the command until it is ready', () => {
    const execute = jest.fn();

    render(
      <HeadlessEngineCommandWrapperEffect execute={execute} ready={false} />,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(mockUnmountCommand).not.toHaveBeenCalled();
  });
});
