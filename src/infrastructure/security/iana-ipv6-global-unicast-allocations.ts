// Snapshot of RIR allocations from the IANA IPv6 Global Unicast Address Space registry.
//
// Source: https://www.iana.org/assignments/ipv6-unicast-address-assignments/
// Registry last updated: 2025-10-10.
//
// IANA-owned special-purpose allocations (for example 2001::/23 and 2002::/16) are deliberately
// excluded from this allowlist. PublicUrlSecurityPolicy remains fail-closed and accepts only RIR
// allocations listed here, with additional explicit exclusions applied by the policy.

export const IANA_IPV6_GLOBAL_UNICAST_REGISTRY_LAST_UPDATED = '2025-10-10';

export const IANA_IPV6_RIR_ALLOCATED_CIDRS: readonly (readonly [string, number])[] = [
  ['2001:200::', 23],
  ['2001:400::', 23],
  ['2001:600::', 23],
  ['2001:800::', 22],
  ['2001:c00::', 23],
  ['2001:e00::', 23],
  ['2001:1200::', 23],
  ['2001:1400::', 22],
  ['2001:1800::', 23],
  ['2001:1a00::', 23],
  ['2001:1c00::', 22],
  ['2001:2000::', 19],
  ['2001:4000::', 23],
  ['2001:4200::', 23],
  ['2001:4400::', 23],
  ['2001:4600::', 23],
  ['2001:4800::', 23],
  ['2001:4a00::', 23],
  ['2001:4c00::', 23],
  ['2001:5000::', 20],
  ['2001:8000::', 19],
  ['2001:a000::', 20],
  ['2001:b000::', 20],
  ['2003::', 18],
  ['2400::', 12],
  ['2410::', 12],
  ['2600::', 12],
  ['2610::', 23],
  ['2620::', 23],
  ['2630::', 12],
  ['2800::', 12],
  ['2a00::', 12],
  ['2a10::', 12],
  ['2c00::', 12],
];
