import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from '../../common/app-error';
import { validationFailed } from '../../common/errors';

export interface LocalNetwork {
  allowedCidrs: string[];
  allowLoopback: boolean;
}

type Addr = ipaddr.IPv4 | ipaddr.IPv6;

function parseAddr(ip: string): Addr {
  const a = ipaddr.parse(ip.replace(/^\[|\]$/g, ''));
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) xét theo IPv4 bên trong (docs/09 §6.1)
  return a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress()
    ? (a as ipaddr.IPv6).toIPv4Address()
    : a;
}

const METADATA_V6 = ipaddr.parse('fd00:ec2::254');
// Không bao giờ cho phép, kể cả khi CIDR nội bộ bao trùm (link-local gồm 169.254.169.254)
const ALWAYS_BLOCKED = new Set(['unspecified', 'broadcast', 'multicast', 'linkLocal', 'reserved']);

export function ipRange(ip: string): string {
  const a = parseAddr(ip);
  if (a.kind() === 'ipv6' && a.toNormalizedString() === METADATA_V6.toNormalizedString())
    return 'linkLocal';
  return a.range();
}

export const isLoopbackIp = (ip: string) => ipRange(ip) === 'loopback';
export const isAlwaysBlocked = (ip: string) => ALWAYS_BLOCKED.has(ipRange(ip));
export const isPublicIp = (ip: string) => ipRange(ip) === 'unicast';

export function inCidrs(ip: string, cidrs: string[]): boolean {
  const a = parseAddr(ip);
  return cidrs.some((c) => {
    const [net, bits] = ipaddr.parseCIDR(c);
    return net.kind() === a.kind() && a.match(net, bits);
  });
}

/** Chuẩn hóa CIDR; từ chối dải chạm vào nhóm "luôn chặn" (metadata, link-local...) */
export function normalizeCidrs(cidrs: string[]): string[] {
  return cidrs.map((c) => {
    let parsed: [Addr, number];
    try {
      parsed = ipaddr.parseCIDR(c);
    } catch {
      throw validationFailed('CIDR không hợp lệ', [{ path: 'allowedCidrs', message: c }]);
    }
    const [net, bits] = parsed;
    if (ALWAYS_BLOCKED.has(net.range()) || inCidrs('169.254.169.254', [c])) {
      throw validationFailed('Dải IP không được phép', [
        { path: 'allowedCidrs', message: `${c} chứa dải metadata/link-local luôn bị chặn` },
      ]);
    }
    return `${net.toString()}/${bits}`;
  });
}

export function parseLocalNetwork(settings: unknown): LocalNetwork {
  const ln = (settings as { localNetwork?: Partial<LocalNetwork> } | null)?.localNetwork;
  return {
    allowedCidrs: normalizeCidrs(Array.isArray(ln?.allowedCidrs) ? ln.allowedCidrs : []),
    allowLoopback: ln?.allowLoopback === true,
  };
}

export type Resolve = (host: string) => Promise<string[]>;
export const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

const targetNotAllowed = (message: string, howToFix: string) =>
  new AppError('TARGET_NOT_ALLOWED', 403, message, [{ howToFix }]);

/**
 * Môi trường LOCAL (D-23): host phải là loopback (chỉ kiểu Cá nhân + allowLoopback) hoặc
 * phân giải vào dải mạng nội bộ Admin đã bật. Mọi IP phân giải ra đều phải hợp lệ.
 */
export async function assertLocalTarget(
  url: string,
  mode: 'personal' | 'server',
  net: LocalNetwork,
  resolve: Resolve = resolveAll,
): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  let ips: string[];
  if (isIP(host)) ips = [host];
  else if (host === 'localhost') ips = ['127.0.0.1'];
  else {
    ips = await resolve(host).catch(() => {
      throw targetNotAllowed(
        `Không phân giải được host ${host}`,
        'Kiểm tra lại địa chỉ hoặc dùng IP LAN',
      );
    });
  }
  for (const ip of ips) {
    if (isLoopbackIp(ip)) {
      if (mode === 'server') {
        throw targetNotAllowed(
          'Hub máy chủ không tới được localhost của máy bạn',
          'Dùng IP LAN của máy chạy website (vd. http://192.168.1.50:3000) và cho app listen 0.0.0.0',
        );
      }
      if (!net.allowLoopback) {
        throw targetNotAllowed(
          'Chưa cho phép test localhost',
          '/settings/targets: bật "Cho phép localhost"',
        );
      }
      continue;
    }
    if (isAlwaysBlocked(ip)) throw targetNotAllowed(`IP ${ip} luôn bị chặn`, 'Dùng địa chỉ khác');
    if (!inCidrs(ip, net.allowedCidrs)) {
      throw targetNotAllowed(
        `IP ${ip} không nằm trong dải mạng nội bộ đã bật`,
        '/settings/targets: Admin thêm dải IP nội bộ (vd. 192.168.1.0/24)',
      );
    }
  }
}

// ---- Xác minh domain (docs/09 §5) ----

export const VERIFICATION_TXT_PREFIX = 'qa-hub-verification=';
export const WELL_KNOWN_PATH = '/.well-known/qa-hub-verification.txt';

/** Host và các domain cha (≥ 2 nhãn): a.b.example.vn → a.b.example.vn, b.example.vn, example.vn */
export function dnsCandidates(hostPattern: string): string[] {
  const labels = hostPattern.replace(/^\*\./, '').split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

export interface IpPolicy {
  allowPrivateNetwork: boolean;
  allowedCidrs: string[];
}

export function ipAllowedForTarget(ip: string, p: IpPolicy): boolean {
  if (isPublicIp(ip)) return true;
  return (
    p.allowPrivateNetwork &&
    !isAlwaysBlocked(ip) &&
    !isLoopbackIp(ip) &&
    inCidrs(ip, p.allowedCidrs)
  );
}

/**
 * GET nhỏ có chặn SSRF: phân giải DNS một lần, kiểm mọi IP, kết nối đúng IP đã kiểm
 * (chống DNS rebinding), không theo redirect, timeout 5 s, đọc tối đa 4 KB.
 * shortcut: dùng riêng cho xác minh domain; net-guard đầy đủ cho runner ở Phase 3.
 */
export function safeGetText(url: string, policy: IpPolicy, timeoutMs = 5000): Promise<string> {
  const u = new URL(url);
  const pinnedLookup: LookupFunction = (hostname, _opts, cb) => {
    resolveAll(hostname)
      .then((ips) => {
        const bad = ips.find((ip) => !ipAllowedForTarget(ip, policy));
        if (!ips.length || bad) return cb(new Error(`IP ${bad ?? '?'} không được phép`), '', 4);
        cb(null, ips[0]!, isIP(ips[0]!));
      })
      .catch((err: Error) => cb(err, '', 4));
  };
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(u, { lookup: pinnedLookup, timeout: timeoutMs }, (res) => {
      if ((res.statusCode ?? 0) >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 4096) req.destroy(new Error('Phản hồi quá lớn'));
      });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('Hết thời gian chờ')));
    req.on('error', reject);
  });
}
