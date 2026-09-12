import { Link, Outlet, useNavigation, useRouteError } from 'react-router-dom';

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
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
    <h1 className="text-xl font-semibold">页面加载失败</h1>
    <p>页面未能正常显示。请重新加载或返回书架；已保存的数据不会被重置。</p>
    {import.meta.env.DEV && error instanceof Error && <pre className="max-w-3xl whitespace-pre-wrap text-sm" role="alert">{error.message}</pre>}
    <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={() => window.location.reload()}>
      重新加载
    </button>
    <Link to="/dashboard" className="text-blue-600 underline">返回书架</Link>
  </main>;
}
