# Bridge request body limits

The root bridge applies explicit UTF-8 byte limits to every route that accepts a JSON request body. Limits are selected by request class rather than relying on Fastify's global default.

| Request class | Limit | Routes | Rationale |
| --- | ---: | --- | --- |
| Small control | 64 KiB | project selection, memory updates, claims, heartbeats, approvals and lifecycle controls | These payloads contain identifiers, short labels, tokens or small metadata only. |
| Context preview | 256 KiB | `/project/context/preview` | The request contains references and numeric budget settings; file contents are read locally and are not uploaded in this body. |
| Workflow | 8 MiB | `/workspace/runs`, `/session/prompt`, browser chunks, responses and messages | Supports the advertised two-million-character workflow/context ceiling even when content uses four-byte UTF-8 code points, with JSON-envelope headroom. |
| Operations | 8 MiB | `/operations/preview` | Supports substantial reviewed file-operation plans while bounding parser memory and rejecting excessive input before planning or persistence. |

## Boundary behavior

A body whose encoded byte length equals the route limit is accepted for parsing. A body one byte over the limit is rejected with HTTP 413 and a stable response:

```json
{
  "error": "Request body exceeds the configured route limit",
  "code": "PAYLOAD_TOO_LARGE",
  "route": "/session/prompt",
  "observedBytes": 8388609,
  "limitBytes": 8388608
}
```

`observedBytes` is derived from the HTTP `Content-Length` header when available. Limits are bytes, not JavaScript character counts, so multibyte Unicode is accounted for correctly.

## Maintenance rule

Every new JSON body route must be added to `BRIDGE_ROUTE_BODY_LIMITS` and registered with `bridgeBodyLimit(route)`. Boundary regression coverage must include the route's request class before the route is merged.
