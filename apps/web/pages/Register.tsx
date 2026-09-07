import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../InteractionContent/AppContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { UserPlus } from 'lucide-react';

function Register(): React.ReactElement {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { register } = useApp();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        setError('');

        if (!username || !password || !nickname) {
            setError('Please fill in all fields');
            return;
        }

        setLoading(true);
        // Call the register function method in the context
        const success = await register(username, password, nickname);
        setLoading(false);

        if (success) {
            // Resister Successful, navigate to login page
            alert('Registration successful! Please log in.');
            navigate('/login');
        } else {
            setError('Registration failed. Username might be taken.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 transition-colors duration-300">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                {/* Header - Purple Theme for Registration to distinguish from Login */}
                <div className="bg-purple-600 p-8 text-center">
                    <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                        <UserPlus className="text-white" size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-white font-serif">Join StoryArk</h1>
                    <p className="text-purple-100 mt-2">Start your creative journey today</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <Input
                            label="Username"
                            placeholder="Choose a username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />

                        <Input
                            label="Nickname"
                            placeholder="What should we call you?"
                            helperText="This will be displayed as the author name."
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                        />

                        <Input
                            label="Password"
                            type="password"
                            placeholder="Create a strong password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />

                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-rose-950/40 text-red-600 dark:text-rose-300 text-sm rounded-lg border border-red-100 dark:border-rose-900">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 focus:ring-purple-500" size="lg" disabled={loading}>
                            {loading ? 'Creating Account...' : 'Sign Up'}
                        </Button>

                        <div className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
                            Already have an account?{' '}
                            <Link to="/login" className="text-purple-600 dark:text-purple-300 font-medium hover:underline">
                                Sign In
                            </Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default Register;
