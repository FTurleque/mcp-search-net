export type TelemetryEvent =
  | 'server_started'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'cache_hit'
  | 'cache_miss'
  | 'search_provider_called'
  | 'content_fetcher_called'
  | 'url_blocked'
  | 'response_truncated';

export interface Telemetry {
  record(event: TelemetryEvent, data?: Readonly<Record<string, unknown>>): void;
}

export interface OperationContext {
  readonly requestId?: string;
}
