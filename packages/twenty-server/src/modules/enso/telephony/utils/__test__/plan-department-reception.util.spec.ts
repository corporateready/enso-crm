import { planDepartmentReception } from 'src/modules/enso/telephony/utils/plan-department-reception.util';

describe('planDepartmentReception', () => {
  // Shape of the live PBX on 2026-09-29: every sales manager sits in the shared
  // departments plus a one-person group behind their personal line.
  const groups = [
    {
      groupId: 'sales',
      memberLogins: ['alexandru_morosanu', 'oleg_luchian', 'sergiu_surjco'],
      receivingLogins: ['alexandru_morosanu', 'oleg_luchian', 'sergiu_surjco'],
    },
    {
      groupId: 'g_personal_alexandru',
      memberLogins: ['alexandru_morosanu'],
      receivingLogins: ['alexandru_morosanu'],
    },
    {
      groupId: 'g_artima',
      memberLogins: ['alexandru_morosanu', 'olvanica_alexandru'],
      receivingLogins: ['alexandru_morosanu'],
    },
    {
      groupId: 'g_triumf_support',
      memberLogins: ['zinaida_dumbrava'],
      receivingLogins: ['zinaida_dumbrava'],
    },
  ];

  it('should switch off shared departments but never the personal line when a manager pauses', () => {
    const plan = planDepartmentReception({
      login: 'alexandru_morosanu',
      isReceiving: false,
      groups,
    });

    expect(plan.toChange).toEqual(['sales']);
    expect(plan.personal).toEqual(['g_personal_alexandru']);
  });

  it('should keep the last receiver of a department on', () => {
    const plan = planDepartmentReception({
      login: 'alexandru_morosanu',
      isReceiving: false,
      groups,
    });

    expect(plan.keptOnAsLastReceiver).toEqual(['g_artima']);
  });

  it('should ignore groups the manager is not in', () => {
    const plan = planDepartmentReception({
      login: 'alexandru_morosanu',
      isReceiving: false,
      groups,
    });

    expect(Object.values(plan).flat()).not.toContain('g_triumf_support');
  });

  it('should turn a paused manager back on even when others are off', () => {
    const plan = planDepartmentReception({
      login: 'oleg_luchian',
      isReceiving: true,
      groups: [
        {
          groupId: 'sales',
          memberLogins: ['oleg_luchian', 'sergiu_surjco'],
          receivingLogins: [],
        },
      ],
    });

    expect(plan.toChange).toEqual(['sales']);
  });

  it('should send nothing for departments already in the requested state', () => {
    const plan = planDepartmentReception({
      login: 'oleg_luchian',
      isReceiving: true,
      groups,
    });

    expect(plan.toChange).toEqual([]);
    expect(plan.unchanged).toEqual(['sales']);
  });
});
