export type TelemetryEvent =
  | 'server_started'
  | 'server_stopped'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'cache_hit'
  | 'cache_miss'
  | 'provider_called'
  | 'provider_failed'
  | 'url_blocked'
  | 'content_truncated'
  | 'configuration_invalid';

export interface Telemetry {
  record(event: TelemetryEvent, data?: Readonly<Record<string, unknown>>): void;
}

export interface OperationContext {
  readonly requestId?: string;
}
