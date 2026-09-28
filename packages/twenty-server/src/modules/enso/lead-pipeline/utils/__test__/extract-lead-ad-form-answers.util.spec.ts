import { extractLeadAdFormAnswers } from 'src/modules/enso/lead-pipeline/utils/extract-lead-ad-form-answers.util';

describe('extractLeadAdFormAnswers', () => {
  // Field names and values exactly as Meta returned them for a real
  // Newton Buiucani lead on 2026-09-28.
  const submittedPayload = {
    field_data: [
      { name: 'utm_source', values: ['facebook'] },
      { name: 'full_name', values: ['Tania Jornea'] },
      {
        name: 'căutați_un_spațiu_pentru_ce_tip_de_activitate?',
        values: ['spațiu_comercial'],
      },
      {
        name: 'ce_suprafețe_vă_interesează,_în_ce_interval?',
        values: ['98_m²'],
      },
      { name: 'phone_number', values: ['+37378083230'] },
    ],
  };

  it('should label the form questions and drop identity and utm fields', () => {
    expect(extractLeadAdFormAnswers(submittedPayload)).toEqual([
      { label: 'Unit Type', value: 'spațiu comercial' },
      { label: 'Area', value: '98 m²' },
    ]);
  });

  it('should keep an unrecognised question under its own wording', () => {
    expect(
      extractLeadAdFormAnswers({
        field_data: [{ name: 'când_doriți_să_vă_mutați?', values: ['2027'] }],
      }),
    ).toEqual([{ label: 'când doriți să vă mutați?', value: '2027' }]);
  });

  it('should skip blank answers', () => {
    expect(
      extractLeadAdFormAnswers({
        field_data: [{ name: 'suprafata', values: [''] }],
      }),
    ).toEqual([]);
  });

  it('should return nothing for a payload without field_data', () => {
    expect(extractLeadAdFormAnswers(null)).toEqual([]);
    expect(extractLeadAdFormAnswers({ id: '1' })).toEqual([]);
  });
});
