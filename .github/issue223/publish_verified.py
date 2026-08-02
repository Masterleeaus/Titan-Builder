from pathlib import Path


def apply_or_confirm(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old in text:
        if text.count(old) != 1:
            raise SystemExit(f"Ambiguous verified publication anchor in {path}: {old[:120]!r}")
        file.write_text(text.replace(old, new, 1))
        return
    if new not in text:
        raise SystemExit(f"Neither vulnerable nor corrected form exists in {path}: {old[:120]!r}")


apply_or_confirm(
    "browser-extension/bridge-server.ts",
    """import {
  BridgeConnectionError,
  requestAuthenticatedBridge,
} from './bridge-connection-transport.js';""",
    """import { requestAuthenticatedBridge } from './bridge-connection-transport.js';""",
)
apply_or_confirm(
    "browser-extension/bridge-server.ts",
    """    let response: Response;
    try {
      response = await authenticatedBridgeRequest({
        endpoint: bridgeEndpoint,
        controlToken: bridgeToken,
        method,
        route,
        body,
      });
    } catch (error) {
      if (error instanceof BridgeConnectionError) {
        throw new WorkspaceHttpError(error.message, error.statusCode);
      }
      throw error;
    }

    const text = await response.text();""",
    """    const response = await authenticatedBridgeRequest({
      endpoint: bridgeEndpoint,
      controlToken: bridgeToken,
      method,
      route,
      body,
    });

    const text = await response.text();""",
)
apply_or_confirm(
    "browser-extension/bridge-connection-transport.ts",
    """    if (identityResponse.socket.destroyed || !identityResponse.socket.writable) {
      throw new BridgeConnectionError(
        'Authenticated bridge connection closed before bearer delivery.',
      );
    }
""",
    """    const identityConnection = identityResponse.headers.get('connection')
      ?.split(',')
      .map((value) => value.trim().toLowerCase());
    if (
      identityConnection?.includes('close')
      || identityResponse.socket.destroyed
      || !identityResponse.socket.writable
    ) {
      throw new BridgeConnectionError(
        'Authenticated bridge connection closed before bearer delivery.',
      );
    }
""",
)
