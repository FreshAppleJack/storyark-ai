import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // 引入 Link
import { useApp } from '../InteractionContent/AppContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Feather } from 'lucide-react';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useApp();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const success = await login(username, password);
    if (success) {
      navigate('/dashboard');
    } else {
      setError('Invalid credentials. Try StoryArk / 12345678');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 transition-colors duration-300">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="bg-brand-600 p-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <Feather className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white font-serif">StoryArk</h1>
          <p className="text-brand-100 mt-2">Your Intelligent Creative Companion</p>
        </div>

        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 text-red-600 dark:text-rose-300 text-sm rounded-lg border border-red-100 dark:border-rose-900">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg">
              Sign In to StoryArk
            </Button>

            <div className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
              Demo Credentials: StoryArk / 12345678
            </div>
            {/* 跳转到注册页的链接 */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
              Don't have an account?{' '}
              <Link to="/register" className="text-brand-600 dark:text-brand-300 font-medium hover:underline">
                  Sign Up
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
