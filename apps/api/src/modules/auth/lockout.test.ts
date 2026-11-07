import { describe, expect, it } from 'vitest';
import { lockMinutes } from './lockout';

describe('lockMinutes', () => {
  it('chưa đủ 5 lần sai thì không khóa', () => {
    expect([1, 2, 3, 4].map(lockMinutes)).toEqual([0, 0, 0, 0]);
  });
  it('lần khóa đầu 15 phút, sau đó gấp đôi', () => {
    expect(lockMinutes(5)).toBe(15);
    expect(lockMinutes(10)).toBe(30);
    expect(lockMinutes(15)).toBe(60);
  });
  it('tối đa 24 giờ', () => {
    expect(lockMinutes(100)).toBe(1440);
  });
});
