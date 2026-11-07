import { describe, expect, it } from 'vitest';
import en from './en.json';
import vi from './vi.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('vi và en có cùng bộ khóa', () => {
    expect(keys(en).sort()).toEqual(keys(vi).sort());
  });
});
