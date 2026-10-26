import { createElement, lazy, type ComponentType } from 'react';

/**
 * A code-split component that renders synchronously once its chunk is in.
 *
 * `React.lazy` suspends on its first render even when the chunk was already
 * fetched, so the page area showed its (empty) fallback for a few frames:
 * the black flash when opening Settings or About. Here, after `preload()`
 * resolves the real component is rendered directly; the lazy wrapper is only
 * a fallback for a click that beats the preload.
 */
export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        pending = null; // let a later attempt retry
        throw error;
      },
    ));
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function Preloadable(props: P) {
    return createElement(loaded ?? Lazy, props);
  }
  return { Component: Preloadable, preload, isLoaded: () => loaded !== null };
}
