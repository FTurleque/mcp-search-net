export interface DnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}
