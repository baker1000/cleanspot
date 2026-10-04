import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { GeocodeError, type Bbox, type GeocodeResult, type Geocoder } from '@/features/geocoding';

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; results: GeocodeResult[] }
  | { kind: 'error'; reason: 'rate_limited' | 'network' | 'server' };

/**
 * Place search. Sends a request only when the form is submitted (no autocomplete), as the
 * Nominatim usage policy requires; the geocoder itself enforces 1 request/second.
 */
export function PlaceSearch({
  geocoder,
  viewbox,
  onPick,
}: {
  geocoder: Geocoder;
  viewbox: Bbox | null;
  onPick(result: GeocodeResult): void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const statusId = useId();

  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state.kind === 'searching' || query.trim().length < 2) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'searching' });
    try {
      const results = await geocoder.search(query, {
        language: i18n.language,
        viewbox: viewbox ?? undefined,
        signal: controller.signal,
      });
      setState({ kind: 'results', results });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        kind: 'error',
        reason: error instanceof GeocodeError ? error.reason : 'network',
      });
    }
  }

  function pick(result: GeocodeResult) {
    setState({ kind: 'idle' });
    onPick(result);
  }

  const message =
    state.kind === 'searching'
      ? t('map.search.searching')
      : state.kind === 'results'
        ? state.results.length
          ? t('map.search.results', { count: state.results.length })
          : t('map.search.none')
        : state.kind === 'error'
          ? t(`map.search.errors.${state.reason}`)
          : '';

  return (
    <div className="flex flex-col gap-1">
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t('map.search.label')}
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('map.search.placeholder')}
          autoComplete="off"
          enterKeyHint="search"
          aria-describedby={statusId}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-500 bg-white px-3 py-2 text-base text-slate-900"
        />
        <Button
          type="submit"
          loading={state.kind === 'searching'}
          aria-label={t('map.search.submit')}
        >
          <SearchIcon />
        </Button>
      </form>

      <p
        id={statusId}
        role="status"
        className={message ? 'rounded bg-white/95 px-2 py-1 text-sm text-slate-800' : 'sr-only'}
      >
        {message}
      </p>

      {state.kind === 'results' && state.results.length > 0 && (
        <div className="rounded-lg border border-slate-300 bg-white shadow-md">
          <ul aria-label={t('map.search.resultsLabel')}>
            {state.results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="min-h-11 w-full border-b border-slate-200 px-3 py-2 text-start text-slate-900 hover:bg-slate-100"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="px-3 py-1 text-xs text-slate-700">
            {t('map.search.attribution')}{' '}
            <a
              href={geocoder.attribution.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {geocoder.attribution.text}
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
