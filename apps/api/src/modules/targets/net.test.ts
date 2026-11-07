import { describe, expect, it } from 'vitest';
import {
  assertLocalTarget,
  dnsCandidates,
  inCidrs,
  ipAllowedForTarget,
  isAlwaysBlocked,
  normalizeCidrs,
} from './net';

const lan = { allowedCidrs: ['192.168.1.0/24'], allowLoopback: true };

describe('phân loại IP', () => {
  it('metadata cloud và link-local luôn bị chặn', () => {
    expect(isAlwaysBlocked('169.254.169.254')).toBe(true);
    expect(isAlwaysBlocked('fd00:ec2::254')).toBe(true);
    expect(isAlwaysBlocked('0.0.0.0')).toBe(true);
  });
  it('IPv4-mapped IPv6 xét theo IPv4 bên trong', () => {
    expect(inCidrs('::ffff:192.168.1.7', ['192.168.1.0/24'])).toBe(true);
    expect(
      ipAllowedForTarget('::ffff:127.0.0.1', {
        allowPrivateNetwork: true,
        allowedCidrs: ['127.0.0.0/8'],
      }),
    ).toBe(false);
  });
  it('IP private chỉ được phép khi bật private network và nằm trong CIDR', () => {
    const p = { allowPrivateNetwork: true, allowedCidrs: ['10.20.30.0/24'] };
    expect(ipAllowedForTarget('10.20.30.5', p)).toBe(true);
    expect(ipAllowedForTarget('10.20.31.5', p)).toBe(false);
    expect(ipAllowedForTarget('10.20.30.5', { ...p, allowPrivateNetwork: false })).toBe(false);
    expect(ipAllowedForTarget('8.8.8.8', { allowPrivateNetwork: false, allowedCidrs: [] })).toBe(
      true,
    );
  });
  it('từ chối CIDR chứa dải metadata', () => {
    expect(() => normalizeCidrs(['169.254.0.0/16'])).toThrow();
    expect(() => normalizeCidrs(['0.0.0.0/0'])).toThrow();
    expect(normalizeCidrs(['192.168.1.0/24'])).toEqual(['192.168.1.0/24']);
  });
});

describe('assertLocalTarget', () => {
  const noDns = async () => {
    throw new Error('no dns');
  };

  it('kiểu Cá nhân + allowLoopback cho phép localhost', async () => {
    await expect(
      assertLocalTarget('http://localhost:3000', 'personal', lan, noDns),
    ).resolves.toBeUndefined();
    await expect(
      assertLocalTarget('http://[::1]:3000', 'personal', lan, noDns),
    ).resolves.toBeUndefined();
  });
  it('kiểu Máy chủ từ chối localhost, gợi ý IP LAN', async () => {
    await expect(
      assertLocalTarget('http://localhost:3000', 'server', lan, noDns),
    ).rejects.toMatchObject({
      code: 'TARGET_NOT_ALLOWED',
    });
  });
  it('chưa bật allowLoopback thì từ chối', async () => {
    await expect(
      assertLocalTarget(
        'http://127.0.0.1:3000',
        'personal',
        { ...lan, allowLoopback: false },
        noDns,
      ),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
  });
  it('IP LAN phải nằm trong dải đã bật', async () => {
    await expect(
      assertLocalTarget('http://192.168.1.50:3000', 'server', lan, noDns),
    ).resolves.toBeUndefined();
    await expect(assertLocalTarget('http://10.0.0.5:3000', 'server', lan, noDns)).rejects.toThrow();
  });
  it('hostname phân giải ra nhiều IP: mọi IP đều phải hợp lệ', async () => {
    const mixed = async () => ['192.168.1.9', '169.254.169.254'];
    await expect(assertLocalTarget('http://dev.lan:3000', 'server', lan, mixed)).rejects.toThrow();
  });
  it('IP công khai không phải LOCAL', async () => {
    await expect(assertLocalTarget('http://8.8.8.8', 'personal', lan, noDns)).rejects.toThrow();
  });
});

describe('dnsCandidates', () => {
  it('host và domain cha, bỏ wildcard', () => {
    expect(dnsCandidates('a.b.example.vn')).toEqual([
      'a.b.example.vn',
      'b.example.vn',
      'example.vn',
    ]);
    expect(dnsCandidates('*.example.vn')).toEqual(['example.vn']);
  });
});
