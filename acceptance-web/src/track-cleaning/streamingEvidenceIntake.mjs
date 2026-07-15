export function createStreamingEvidenceIntakeState(overrides = {}) {
  return {
    events: cloneArray(overrides.events),
    parseErrors: cloneArray(overrides.parseErrors),
    pendingText: typeof overrides.pendingText === 'string' ? overrides.pendingText : '',
    lastEventSeqBySession: cloneObject(overrides.lastEventSeqBySession) || {},
    seenEventKeys: cloneArray(overrides.seenEventKeys),
    duplicateEventCount: finiteNumber(overrides.duplicateEventCount) ?? 0,
    outOfOrderEventCount: finiteNumber(overrides.outOfOrderEventCount) ?? 0,
    finished: overrides.finished === true,
    chunkCount: finiteNumber(overrides.chunkCount) ?? 0
  };
}

export function appendEvidenceJsonlChunk(previousState = {}, chunk = '', options = {}) {
  const state = createStreamingEvidenceIntakeState(previousState);
  if (state.finished) return state;

  const text = state.pendingText + String(chunk || '');
  const endsWithLineBreak = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  const completeLines = options.finish === true || endsWithLineBreak
    ? lines
    : lines.slice(0, -1);
  const pendingText = options.finish === true || endsWithLineBreak
    ? ''
    : lines.at(-1) ?? '';

  const next = appendEvidenceLines({
    ...state,
    pendingText,
    chunkCount: state.chunkCount + 1
  }, completeLines);

  return options.finish === true
    ? finishEvidenceIntake(next)
    : next;
}

export function appendEvidenceEvents(previousState = {}, events = []) {
  const state = createStreamingEvidenceIntakeState(previousState);
  if (state.finished) return state;
  let next = state;
  for (const event of events || []) {
    next = addEvent(next, event);
  }
  return next;
}

export function finishEvidenceIntake(previousState = {}) {
  const state = createStreamingEvidenceIntakeState(previousState);
  const withPending = state.pendingText
    ? appendEvidenceLines({ ...state, pendingText: '' }, [state.pendingText])
    : state;
  return {
    ...withPending,
    pendingText: '',
    finished: true
  };
}

export function evidenceIntakeJsonl(state) {
  return (state?.events || [])
    .map((event) => JSON.stringify(event))
    .join('\n');
}

export function evidenceIntakeSummary(state) {
  return {
    eventCount: state?.events?.length || 0,
    parseErrorCount: state?.parseErrors?.length || 0,
    pendingTextBytes: state?.pendingText?.length || 0,
    duplicateEventCount: state?.duplicateEventCount || 0,
    outOfOrderEventCount: state?.outOfOrderEventCount || 0,
    finished: state?.finished === true,
    chunkCount: state?.chunkCount || 0
  };
}

function appendEvidenceLines(state, lines) {
  let next = state;
  for (const line of lines || []) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    try {
      next = addEvent(next, JSON.parse(trimmed));
    } catch (error) {
      next = {
        ...next,
        parseErrors: [
          ...next.parseErrors,
          {
            lineText: trimmed.slice(0, 160),
            message: error.message
          }
        ]
      };
    }
  }
  return next;
}

function addEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  const key = eventKey(event);
  if (key && state.seenEventKeys.includes(key)) {
    return {
      ...state,
      duplicateEventCount: state.duplicateEventCount + 1
    };
  }

  const sessionId = String(event.sessionId || '');
  const eventSeq = finiteNumber(event.eventSeq);
  const lastSeq = sessionId ? finiteNumber(state.lastEventSeqBySession[sessionId]) : null;
  const outOfOrder = sessionId && Number.isFinite(eventSeq)
    && Number.isFinite(lastSeq)
    && eventSeq <= lastSeq;
  const lastEventSeqBySession = sessionId && Number.isFinite(eventSeq)
    ? {
      ...state.lastEventSeqBySession,
      [sessionId]: Math.max(eventSeq, Number.isFinite(lastSeq) ? lastSeq : eventSeq)
    }
    : state.lastEventSeqBySession;

  return {
    ...state,
    events: [...state.events, event],
    seenEventKeys: key ? [...state.seenEventKeys, key] : state.seenEventKeys,
    lastEventSeqBySession,
    outOfOrderEventCount: state.outOfOrderEventCount + (outOfOrder ? 1 : 0)
  };
}

function eventKey(event) {
  const sessionId = String(event.sessionId || '');
  const eventSeq = finiteNumber(event.eventSeq);
  if (!sessionId || !Number.isFinite(eventSeq)) return null;
  return `${sessionId}:${eventSeq}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => structuredCloneFallback(item)) : [];
}

function cloneObject(value) {
  return value && typeof value === 'object' ? structuredCloneFallback(value) : null;
}

function structuredCloneFallback(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value;
}
