/**
 * Same-network heuristic (SPEC §5): the same public IPv4 address, or the same IPv6 /64 prefix.
 * Guests on mobile data or a VPN fail it, and so can two devices on one Wi-Fi when one of them
 * reaches the server over IPv4 and the other over IPv6.
 */
export function sameNetwork(a: string, b: string): boolean {
	const key = networkKey(a);
	return key !== null && key === networkKey(b);
}

/** "v4:203.0.113.7" or "v6:" + the first four groups, normalized; null if it isn't an IP. */
function networkKey(raw: string): string | null {
	let ip = raw.trim().toLowerCase().replace(/%.*$/, ''); // drop an IPv6 zone id
	ip = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, ''); // IPv4-mapped IPv6
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return `v4:${ip}`;

	const halves = ip.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves[1] ? halves[1].split(':') : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
	if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
	return `v6:${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}`;
}
