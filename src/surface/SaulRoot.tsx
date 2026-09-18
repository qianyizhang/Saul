import { useEffect, useState, useCallback, useRef } from 'react';
import type { SelectionSnapshot, TagSegment, PortResponse, ResolvedContext } from '../types';
import { captureSelection, buildResolvedContext } from '../capture/selection';
import { setHistoryBookmark } from '../storage/client';
import { FloatingTrigger } from './FloatingTrigger';
import { ExplanationCard, type ExplanationStatus } from './ExplanationCard';

export function SaulRoot() {
  const [uiState, setUiState] = useState<'idle' | 'trigger' | 'explaining'>('idle');
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [segments, setSegments] = useState<TagSegment[]>([]);
  const [status, setStatus] = useState<ExplanationStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>();
  const [pinned, setPinned] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const port = useRef<chrome.runtime.Port | null>(null);
  const revision = useRef(0);
  const contextRef = useRef<{ id: string; context: ResolvedContext } | null>(null);
  const cancel = useCallback(() => {
    revision.current++;
    try {
      port.current?.postMessage({ type: 'ABORT' });
      port.current?.disconnect();
    } catch {
      /* already closed */
    }
    port.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const dismiss = useCallback(() => {
    cancel();
    setUiState('idle');
    setSnapshot(null);
    setRange(null);
    setSegments([]);
    setError(null);
    setLatencyMs(undefined);
    setPinned(false);
    setBookmarked(false);
    contextRef.current = null;
  }, [cancel]);
  async function explain(
    instruction?: string,
    captured?: { snapshot: SelectionSnapshot; range: Range },
  ) {
    const selected = captured?.snapshot || snapshot,
      selectedRange = captured?.range || range;
    if (!selected || !selectedRange) return;
    const previous = segments.map((s) => (s.type === 'text' ? s.text : s.term)).join('');
    cancel();
    const run = revision.current;
    setSnapshot(selected);
    setRange(selectedRange);
    setUiState('explaining');
    setSegments([]);
    setStatus('connecting');
    setError(null);
    setLatencyMs(undefined);
    try {
      let context: ResolvedContext;
      if (contextRef.current?.id === selected.id) context = contextRef.current.context;
      else {
        const result = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT_POLICY' });
        if (!result?.contextPolicy)
          throw new Error('Could not load reading preferences. Reload Saul and try again.');
        if (run !== revision.current) return;
        context = buildResolvedContext(selected, selectedRange, result.contextPolicy);
        contextRef.current = { id: selected.id, context };
      }
      if (run !== revision.current) return;
      const channel = chrome.runtime.connect({ name: 'saul-stream' });
      port.current = channel;
      let finished = false;
      channel.onMessage.addListener((message: PortResponse) => {
        if (run !== revision.current) return;
        if (message.type === 'CHUNK') {
          setSegments(message.payload.segments);
          setStatus('streaming');
        } else if (message.type === 'SAVING') setStatus('saving');
        else if (message.type === 'DONE') {
          finished = true;
          setSegments(message.payload.segments);
          setLatencyMs(message.payload.usage?.latencyMs);
          setStatus('saved');
        } else if (message.type === 'ERROR') {
          finished = true;
          setError(message.payload.message);
          setStatus('error');
        }
      });
      channel.onDisconnect.addListener(() => {
        if (run === revision.current && !finished) {
          setError('Connection interrupted. Retry the explanation.');
          setStatus('error');
        }
      });
      channel.postMessage({
        type: 'START_EXPLAIN',
        payload: {
          snapshot: selected,
          context,
          ...(instruction
            ? {
                customPrompt: `Previous explanation:\n${previous}\n\nFollow-up request: ${instruction}. Keep using the original selection and context.`,
              }
            : {}),
        },
      });
    } catch (err) {
      if (run === revision.current) {
        setError((err as Error).message);
        setStatus('error');
      }
    }
  }
  const explainRef = useRef(explain);
  explainRef.current = explain;
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const inside = (e: Event) =>
      e
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.tagName.toLowerCase() === 'saul-root');
    const editing = (e: Event) =>
      e.target instanceof Element &&
      Boolean(e.target.closest('input,textarea,[contenteditable="true"]'));
    const capture = (e: MouseEvent) => {
      if (inside(e) || editing(e) || uiState === 'explaining') return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const captured = captureSelection();
        if (captured) {
          setSnapshot(captured.snapshot);
          setRange(captured.range);
          setUiState('trigger');
        } else if (uiState === 'trigger') dismiss();
      }, 10);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiState !== 'idle') dismiss();
      if (e.altKey && e.shiftKey && e.code === 'KeyE' && !editing(e)) {
        const captured = captureSelection();
        if (captured) {
          clearTimeout(timeout);
          e.preventDefault();
          void explainRef.current(undefined, captured);
        }
      }
    };
    const outside = (e: MouseEvent) => {
      if (!inside(e) && !pinned && uiState !== 'idle') dismiss();
    };
    document.addEventListener('mouseup', capture);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('mousedown', outside);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mouseup', capture);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('mousedown', outside);
    };
  }, [uiState, pinned, dismiss]);
  if (uiState === 'idle' || !snapshot || !range) return null;
  return uiState === 'trigger' ? (
    <FloatingTrigger range={range} onTrigger={() => void explain()} onDismiss={dismiss} />
  ) : (
    <ExplanationCard
      range={range}
      snapshot={snapshot}
      segments={segments}
      status={status}
      isStreaming={['connecting', 'streaming', 'saving'].includes(status)}
      error={error}
      latencyMs={latencyMs}
      pinned={pinned}
      bookmarked={bookmarked}
      onPin={() => setPinned((v) => !v)}
      onRetry={(instruction) => void explain(instruction)}
      onClose={dismiss}
      onStop={() => {
        cancel();
        setStatus('stopped');
      }}
      onBookmark={() => {
        void setHistoryBookmark(snapshot.id, !bookmarked)
          .then(() => setBookmarked((v) => !v))
          .catch((err) => setError(err.message));
      }}
    />
  );
}
