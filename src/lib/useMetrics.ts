import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsResponse } from '../../shared/types';

export function useMetrics(paused: boolean) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<MetricsResponse | null>(null);
  const lastRefresh = useRef(-1);

  useEffect(() => {
    if (paused && current.current && lastRefresh.current === refreshKey) { setRefreshing(false); return; }
    lastRefresh.current = refreshKey;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function poll() {
      setRefreshing(true);
      try {
        const since = current.current?.history.at(-1)?.timestamp ?? 0;
        const response = await fetch(`/api/metrics?since=${since}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.error || `The local collector returned HTTP ${response.status}.`);
        }
        const next = await response.json() as MetricsResponse;
        if (!next.snapshot?.host || !Array.isArray(next.history)) throw new Error('The collector returned an invalid response.');
        if (cancelled) return;
        const old = current.current?.historyStartedAt === next.historyStartedAt ? current.current.history : [];
        const history = [...new Map([...old, ...next.history].map(point => [point.timestamp, point])).values()].filter(point => point.timestamp >= next.snapshot.timestamp - 3_600_000);
        current.current = { ...next, history };
        setData(current.current);
        setError(Date.now() - next.snapshot.timestamp > Math.max(15_000, next.snapshot.interval * 3) ? 'The collector is delayed. Displaying its last available readings.' : null);
      } catch (problem) {
        if (!cancelled) setError(problem instanceof Error && problem.name !== 'TypeError' ? problem.message : 'Cannot reach the local collector. Retrying automatically.');
      } finally {
        if (!cancelled) {
          setRefreshing(false);
          if (!paused) timer = setTimeout(poll, current.current?.snapshot.interval || 2000);
        }
      }
    }
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [paused, refreshKey]);

  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);
  return { data, error, refresh, refreshing };
}
