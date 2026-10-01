import { i18n, type I18n } from '@lingui/core';
import { SOURCE_LOCALE } from 'twenty-shared/translations';

import { messages as sourceLocaleMessages } from 'src/engine/core-modules/i18n/locales/generated/en';

type MessageCompiler = Parameters<I18n['setMessagesCompiler']>[0];

// Lingui installs its runtime message compiler only when NODE_ENV is not
// "production". In production, every message missing from the active catalog
// falls back to its raw source string AND console.warn-s a multi-line
// "Uncompiled message detected!" block. Since NODE_ENV=production was set on
// Railway, that warning flooded twenty-server past Railway's 500 lines/sec
// cap and hid the real errors. Returning the raw string unchanged keeps
// exactly the output Lingui already falls back to, minus the warning.
export const passThroughMessageCompiler = ((message: string) =>
  message) as unknown as MessageCompiler;

// The `t` and `msg` macros compile to calls on Lingui's global instance, which
// the server never loaded a catalog into, so every one of them (e.g. the
// constantly thrown "Could not find flat entity in maps") took the fallback.
// The compiled source catalog keeps the same English text.
export const setupGlobalI18n = (): void => {
  i18n.setMessagesCompiler(passThroughMessageCompiler);
  i18n.load(SOURCE_LOCALE, sourceLocaleMessages);
  i18n.activate(SOURCE_LOCALE);
};
