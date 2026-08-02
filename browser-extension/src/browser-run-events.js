const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'failed']);

export function parseSseFrames(input = '') {
  const frames = String(input).split('\n\n');
  const remainder = frames.pop() || '';
  const events = [];
  for (const frame of frames) {
    let event = 'message';
    const data = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) continue;
    const raw = data.join('\n');
    try {
      events.push({ event, data: JSON.parse(raw) });
    } catch {
      events.push({ event, data: { raw } });
    }
  }
  return { events, remainder };
}

export function createRunEventMonitor({
  request,
  onSnapshot,
  intervalMs = 2000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let activeRunId = '';
  let timer = null;
  let generation = 0;

  const stop = () => {
    generation += 1;
    activeRunId = '';
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const accept = (snapshot) => {
    if (!snapshot?.id || snapshot.id !== activeRunId) return false;
    onSnapshot?.(snapshot);
    return true;
  };

  const poll = async (runId, expectedGeneration) => {
    if (runId !== activeRunId || expectedGeneration !== generation) return;
    const snapshot = await request(`/workspace/runs/${encodeURIComponent(runId)}`);
    if (!accept(snapshot) || TERMINAL_STATUSES.has(snapshot.status)) return;
    timer = setTimer(() => void poll(runId, expectedGeneration), intervalMs);
  };

  return {
    async start(runId) {
      stop();
      activeRunId = String(runId || '').trim();
      if (!activeRunId) throw new Error('runId is required');
      const expectedGeneration = generation;
      const snapshot = await request(`/workspace/runs/${encodeURIComponent(activeRunId)}`);
      accept(snapshot);
      if (!TERMINAL_STATUSES.has(snapshot.status)) {
        timer = setTimer(() => void poll(activeRunId, expectedGeneration), intervalMs);
      }
      return snapshot;
    },
    accept,
    stop,
    activeRunId: () => activeRunId,
  };
}

export async function streamRunEvents({ url, headers, signal, onSnapshot }) {
  const response = await fetch(url, {
    headers: { ...headers, Accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Run event stream failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseFrames(buffer);
    buffer = parsed.remainder;
    for (const frame of parsed.events) {
      if (frame.event === 'snapshot' || frame.event === 'update') onSnapshot?.(frame.data);
    }
  }
}
