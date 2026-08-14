import { FieldDef } from '../template/template-document';
import {
  imageAssetIds,
  initialData,
  reconcileData,
  validatePieceData,
} from './piece-data';

const fields: FieldDef[] = [
  {
    key: 'titulo',
    label: 'Título',
    type: 'text',
    required: true,
    maxLength: 10,
  },
  { key: 'fecha', label: 'Fecha', type: 'date', required: false },
  {
    key: 'tipo',
    label: 'Tipo',
    type: 'select',
    required: false,
    options: ['A', 'B'],
    defaultValue: 'A',
  },
  { key: 'color', label: 'Color', type: 'color', required: false },
  { key: 'foto', label: 'Foto', type: 'image', required: false },
];

const opts = (requireAll: boolean, images: string[] = []) => ({
  requireAll,
  validImageAssetIds: new Set(images),
});

describe('validatePieceData', () => {
  it('builds initial data from defaults', () => {
    expect(initialData(fields)).toEqual({
      titulo: '',
      fecha: '',
      tipo: 'A',
      color: '',
      foto: '',
    });
  });

  it('allows empty required fields for drafts but not when marking READY', () => {
    expect(validatePieceData(fields, { titulo: '' }, opts(false))).toEqual([]);
    const errors = validatePieceData(fields, { titulo: '' }, opts(true));
    expect(errors).toEqual([
      { field: 'titulo', message: 'Título es obligatorio' },
    ]);
  });

  it('enforces maxLength, date, option, color and image rules', () => {
    const errors = validatePieceData(
      fields,
      {
        titulo: 'demasiado largo!',
        fecha: '2026-02-31',
        tipo: 'Z',
        color: 'rojo',
        foto: 'nope',
      },
      opts(false, ['ok']),
    );
    expect(errors.map((e) => e.field).sort()).toEqual(
      ['color', 'fecha', 'foto', 'tipo', 'titulo'].sort(),
    );
  });

  it('accepts valid values and rejects unknown keys', () => {
    expect(
      validatePieceData(
        fields,
        { titulo: 'Hola', fecha: '2026-05-12', foto: 'ok' },
        opts(true, ['ok']),
      ),
    ).toEqual([]);
    expect(
      validatePieceData(fields, { extra: 'x' }, opts(false)).map(
        (e) => e.field,
      ),
    ).toEqual(['extra']);
  });

  it('lists image asset ids referenced by image fields only', () => {
    expect(imageAssetIds(fields, { foto: 'a1', titulo: 'a2' })).toEqual(['a1']);
  });
});

describe('reconcileData', () => {
  it('keeps matching fields, defaults new ones and reports dropped keys', () => {
    const next: FieldDef[] = [
      { key: 'titulo', label: 'T', type: 'text', required: true },
      { key: 'fecha', label: 'F', type: 'text', required: false },
      {
        key: 'nuevo',
        label: 'N',
        type: 'text',
        required: false,
        defaultValue: 'x',
      },
    ];
    const { data, dropped } = reconcileData(fields, next, {
      titulo: 'Hola',
      fecha: '2026-05-12',
      tipo: 'B',
    });
    expect(data).toEqual({ titulo: 'Hola', fecha: '', nuevo: 'x' });
    expect(dropped.sort()).toEqual(['fecha', 'tipo']);
  });
});
