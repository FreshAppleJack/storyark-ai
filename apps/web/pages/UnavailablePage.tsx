import { Link } from 'react-router-dom';

export function UnavailablePage() {
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Not available in local mode yet</h1>
        <p>Character tools, planning, account settings and AI will return after their local integration.</p>
        <Link to="/dashboard" className="text-brand-600 underline">Back to Bookshelf</Link>
    </main>;
}
