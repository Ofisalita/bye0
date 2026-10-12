import { expect, test } from 'bun:test';
import { sameNetwork } from './network';

test('IPv4: the exact public address', () => {
	expect(sameNetwork('203.0.113.7', '203.0.113.7')).toBe(true);
	expect(sameNetwork('203.0.113.7', '203.0.113.8')).toBe(false);
	expect(sameNetwork('::ffff:203.0.113.7', '203.0.113.7')).toBe(true);
});

test('IPv6: the same /64, however it is written', () => {
	expect(sameNetwork('2001:db8:abcd:12::1', '2001:0db8:abcd:0012:ffff:1:2:3')).toBe(true);
	expect(sameNetwork('2001:db8::1', '2001:db8:0:0:1::')).toBe(true);
	expect(sameNetwork('2001:db8:abcd:12::1', '2001:db8:abcd:13::1')).toBe(false);
	expect(sameNetwork('fe80::1%en0', 'fe80::2')).toBe(true);
	expect(sameNetwork('::1', '::1')).toBe(true);
});

test('anything else never matches', () => {
	expect(sameNetwork('203.0.113.7', '2001:db8::1')).toBe(false);
	expect(sameNetwork('', '')).toBe(false);
	expect(sameNetwork('nope', 'nope')).toBe(false);
	expect(sameNetwork('1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9')).toBe(false);
	expect(sameNetwork('1::2::3', '1::2::3')).toBe(false);
});
