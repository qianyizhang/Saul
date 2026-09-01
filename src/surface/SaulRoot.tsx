import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { SelectionSnapshot, TagSegment, PortResponse } from '../types';
import { captureSelection, buildResolvedContext } from '../capture/selection';
import { getSettings } from '../storage/settings';
import { FloatingTrigger } from './FloatingTrigger';
import { ExplanationCard } from './ExplanationCard';

type UIState = 'idle' | 'trigger' | 'explaining';

export const SaulRoot: React.FC = () => {
  const [uiState, setUiState] = useState<UIState>('idle');
  const [currentSnapshot, setCurrentSnapshot] = useState<SelectionSnapshot | null>(null);
  const [currentRange, setCurrentRange] = useState<Range | null>(null);
  const [segments, setSegments] = useState<TagSegment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  const portRef = useRef<chrome.runtime.Port | null>(null);

  const cleanupStream = useCallback(() => {
    if (portRef.current) {
      try {
        portRef.current.postMessage({ type: 'ABORT' });
        portRef.current.disconnect();
      } catch {
        // Port already closed
      }
      portRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const handleDismiss = useCallback(() => {
    cleanupStream();
    setUiState('idle');
    setCurrentSnapshot(null);
    setCurrentRange(null);
    setSegments([]);
    setError(null);
    setLatencyMs(undefined);
  }, [cleanupStream]);

  // Listen for selection changes on page
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Delay slightly to let selection settle
      setTimeout(() => {
        if (uiState === 'explaining') return;

        const captured = captureSelection();
        if (captured) {
          setCurrentSnapshot(captured.snapshot);
          setCurrentRange(captured.range);
          setUiState('trigger');
        } else if (uiState === 'trigger') {
          handleDismiss();
        }
      }, 10);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If clicking inside saul-root shadow DOM, ignore
      if (target.closest('saul-root') || target.tagName?.toLowerCase() === 'saul-root') {
        return;
      }
      if (uiState !== 'idle') {
        handleDismiss();
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [uiState, handleDismiss]);

  // Trigger explanation
  const handleTriggerExplain = async () => {
    if (!currentSnapshot || !currentRange) return;

    setUiState('explaining');
    setSegments([]);
    setError(null);
    setIsStreaming(true);
    setLatencyMs(undefined);

    const settings = await getSettings();
    const context = buildResolvedContext(currentSnapshot, currentRange, settings.contextPolicy);

    cleanupStream();

    const port = chrome.runtime.connect({ name: 'saul-stream' });
    portRef.current = port;

    port.onMessage.addListener((msg: PortResponse) => {
      if (msg.type === 'CHUNK') {
        setSegments(msg.payload.segments);
      } else if (msg.type === 'DONE') {
        setSegments(msg.payload.segments);
        setIsStreaming(false);
        if (msg.payload.usage?.latencyMs) {
          setLatencyMs(msg.payload.usage.latencyMs);
        }
      } else if (msg.type === 'ERROR') {
        setError(msg.payload.message);
        setIsStreaming(false);
      }
    });

    port.onDisconnect.addListener(() => {
      setIsStreaming(false);
    });

    port.postMessage({
      type: 'START_EXPLAIN',
      payload: {
        snapshot: currentSnapshot,
        context,
      },
    });
  };

  if (uiState === 'idle' || !currentRange || !currentSnapshot) {
    return null;
  }

  return (
    <>
      {uiState === 'trigger' && (
        <FloatingTrigger
          range={currentRange}
          onTrigger={handleTriggerExplain}
          onDismiss={handleDismiss}
        />
      )}

      {uiState === 'explaining' && (
        <ExplanationCard
          range={currentRange}
          snapshot={currentSnapshot}
          segments={segments}
          isStreaming={isStreaming}
          error={error}
          latencyMs={latencyMs}
          onRetry={handleTriggerExplain}
          onClose={handleDismiss}
        />
      )}
    </>
  );
};
