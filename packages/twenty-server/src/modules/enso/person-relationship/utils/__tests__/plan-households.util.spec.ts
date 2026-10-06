import {
  buildHouseholdName,
  groupConnectedPeople,
  planHouseholds,
} from 'src/modules/enso/person-relationship/utils/plan-households.util';

const person = (
  id: string,
  lastName: string,
  householdId: string | null = null,
  createdAt = '2026-01-01',
) => ({ id, lastName, householdId, createdAt });

describe('groupConnectedPeople', () => {
  it('should put everyone connected through links in one group', () => {
    expect(
      groupConnectedPeople(
        ['ion', 'maria', 'gheorghe', 'solo'],
        [
          { personId: 'ion', relatedPersonId: 'maria' },
          { personId: 'maria', relatedPersonId: 'gheorghe' },
        ],
      ),
    ).toEqual([['ion', 'maria', 'gheorghe'], ['solo']]);
  });
});

describe('buildHouseholdName', () => {
  it('should use the most common last name', () => {
    expect(
      buildHouseholdName([
        person('ion', 'Popescu'),
        person('maria', 'Popescu'),
        person('ana', 'Rusu'),
      ]),
    ).toBe('Popescu Family');
  });

  it('should break a tie in favour of the longest-known contact', () => {
    expect(
      buildHouseholdName([
        person('ana', 'Rusu', null, '2026-05-01'),
        person('ion', 'Popescu', null, '2026-01-01'),
      ]),
    ).toBe('Popescu Family');
  });
});

describe('planHouseholds', () => {
  it('should create a household for a new family', () => {
    expect(
      planHouseholds([[person('ion', 'Popescu'), person('maria', 'Popescu')]]),
    ).toEqual({
      create: [{ name: 'Popescu Family', memberIds: ['ion', 'maria'] }],
      assign: [],
      clear: [],
      remove: [],
    });
  });

  it('should add a new relative to the existing household', () => {
    expect(
      planHouseholds([
        [
          person('ion', 'Popescu', 'h1'),
          person('maria', 'Popescu', 'h1'),
          person('ana', 'Rusu'),
        ],
      ]),
    ).toMatchObject({
      create: [],
      assign: [{ householdId: 'h1', memberIds: ['ana'] }],
    });
  });

  it('should fold one household into the other when two families connect', () => {
    expect(
      planHouseholds([
        [
          person('ion', 'Popescu', 'h1'),
          person('maria', 'Popescu', 'h1'),
          person('vasile', 'Popescu', 'h1'),
          person('ana', 'Rusu', 'h2'),
        ],
      ]),
    ).toMatchObject({
      assign: [{ householdId: 'h1', memberIds: ['ana'] }],
      remove: ['h2'],
    });
  });

  it('should give the smaller part of a split family a new household', () => {
    expect(
      planHouseholds([
        [person('ion', 'Popescu', 'h1'), person('maria', 'Popescu', 'h1')],
        [
          person('dan', 'Rusu', 'h1'),
          person('ana', 'Rusu', 'h1'),
          person('gheorghe', 'Rusu', 'h1'),
        ],
      ]),
    ).toMatchObject({
      create: [{ name: 'Popescu Family', memberIds: ['ion', 'maria'] }],
      assign: [],
      remove: [],
    });
  });

  it('should clear someone whose last family link is gone', () => {
    expect(planHouseholds([[person('ion', 'Popescu', 'h1')]], ['h1'])).toEqual({
      create: [],
      assign: [],
      clear: ['ion'],
      remove: ['h1'],
    });
  });
});
