const emptyFlatEntityMaps = {
  byUniversalIdentifier: {},
  universalIdentifierById: {},
  universalIdentifiersByApplicationId: {},
};

type LoadedModules = {
  setupGlobalI18n: () => void;
  throwMissingFlatEntity: () => Error;
  translateUncatalogued: () => string;
};

// Lingui decides whether to install its runtime compiler when its global
// instance is created, from NODE_ENV. Load everything fresh under
// NODE_ENV=production, which is what Railway runs, to reproduce the flood.
const loadUnderProduction = (): LoadedModules => {
  const originalNodeEnv = process.env.NODE_ENV;

  process.env.NODE_ENV = 'production';

  let loaded: LoadedModules | undefined;

  jest.isolateModules(() => {
    const { i18n } = jest.requireActual('@lingui/core');
    const { setupGlobalI18n } = jest.requireActual(
      'src/engine/core-modules/i18n/utils/setup-global-i18n.util',
    );
    const { findFlatEntityByIdInFlatEntityMapsOrThrow } = jest.requireActual(
      'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util',
    );

    loaded = {
      setupGlobalI18n,
      throwMissingFlatEntity: () => {
        try {
          findFlatEntityByIdInFlatEntityMapsOrThrow({
            flatEntityMaps: emptyFlatEntityMaps,
            flatEntityId: 'missing-id',
          });
        } catch (error) {
          return error as Error;
        }

        throw new Error('Expected the lookup to throw');
      },
      translateUncatalogued: () =>
        i18n._({ id: 'not-in-any-catalog', message: 'Plain {name} text' }),
    };
  });

  process.env.NODE_ENV = originalNodeEnv;

  return loaded as LoadedModules;
};

const countUncompiledWarnings = (warnSpy: jest.SpyInstance) =>
  warnSpy.mock.calls.filter((call) =>
    String(call[0]).includes('Uncompiled message detected'),
  ).length;

describe('setupGlobalI18n', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should reproduce the production warning without setup', () => {
    const { throwMissingFlatEntity } = loadUnderProduction();

    throwMissingFlatEntity();

    expect(countUncompiledWarnings(warnSpy)).toBe(1);
  });

  it('should translate a catalogued `t` message without warning', () => {
    const { setupGlobalI18n, throwMissingFlatEntity } = loadUnderProduction();

    setupGlobalI18n();

    expect(throwMissingFlatEntity().message).toBe(
      'Could not find flat entity in maps',
    );
    expect(countUncompiledWarnings(warnSpy)).toBe(0);
  });

  // An uncatalogued message must come back exactly as Lingui's fallback
  // already returned it, so silencing the warning changes no output.
  it('should return an uncatalogued message unchanged without warning', () => {
    const { setupGlobalI18n, translateUncatalogued } = loadUnderProduction();

    setupGlobalI18n();

    expect(translateUncatalogued()).toBe('Plain {name} text');
    expect(countUncompiledWarnings(warnSpy)).toBe(0);
  });
});
