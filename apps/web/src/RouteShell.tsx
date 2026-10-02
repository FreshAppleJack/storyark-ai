import { Link, Outlet, useNavigation, useRouteError } from 'react-router-dom';
import { useEffect } from 'react';
import { reportError } from '../data/diagnostics';

export function RouteLoading() {
  return null;
}

export function RouteShell() {
  const navigation = useNavigation();
  return <>
    {/* Once a blocker allows leaving, prevent new edits during chunk loading. */}
    <div inert={navigation.state === 'loading'} aria-busy={navigation.state === 'loading'}>
      <Outlet />
    </div>
  </>;
}

export function RouteError() {
  const error = useRouteError();
  useEffect(() => { reportError('route', error); }, [error]);
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
    <h1 className="text-xl font-semibold">Page failed to load</h1>
    <p>The page could not be displayed. Reload or return to the bookshelf; saved data will not be reset.</p>
    <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => window.location.reload()}>
      Reload
    </button>
    <Link to="/dashboard" className="text-blue-600 underline">Back to Bookshelf</Link>
  </main>;
}
