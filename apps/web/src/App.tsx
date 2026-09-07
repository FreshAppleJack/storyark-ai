import React from 'react';
import { HashRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import StyleLibrary from '../pages/StyleLibrary';
import Editor from '../pages/EditorPrototype'; // Actually the Real Editor now
import Dashboard from '../pages/Dashboard';
import Login from '../pages/Login';
import Register from '../pages/Register';
import UserSettings from '../pages/UserSettings';
import { AppProvider, useApp } from '../InteractionContent/AppContext';
import { Palette, ChevronRight, LogIn } from 'lucide-react';
import CharacterSettings from "../pages/CharacterSettings.tsx";
import RelationshipMap from "../pages/RelationshipMap.tsx";
import Foreshadowing from "../pages/Foreshadowing.tsx";
import StoryOutline from "../pages/StoryOutline.tsx";
import AiBrainstorm from "../pages/AiBrainstorm.tsx";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// Protected Route Wrapper
function ProtectedRoute({
  children,
}: ProtectedRouteProps): React.ReactElement {
  const { user } = useApp();
  const location = useLocation();

  if (!user?.isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// Landing Page for Navigation
function Home(): React.ReactElement {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full text-center space-y-8">
        <h1 className="text-5xl font-bold text-white tracking-tight mb-2">
          StoryArk <span className="text-brand-500">Sprint 3</span>
        </h1>
        <p className="text-slate-400 text-xl max-w-2xl mx-auto">
          User Stories Implemented: US-101 (Auth), US-102 (Books), US-103 (Editor), US-104 (Sidebar), US-105 (Auto-save)
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
          {/* Card 1: Style Library */}
          <Link to="/style-library" className="group relative block p-8 bg-slate-800 rounded-2xl border border-slate-700 hover:border-brand-500 transition-all duration-300 hover:shadow-2xl hover:shadow-brand-900/20 text-left">
            <div className="absolute top-6 right-6 p-2 bg-slate-700 rounded-lg text-slate-300 group-hover:text-white group-hover:bg-brand-600 transition-colors">
              <ChevronRight size={20} />
            </div>
            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6">
              <Palette className="text-purple-400" size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Part II: Style Library</h2>
            <p className="text-slate-400 mb-6">
              Design System Documentation (Colors, Typography, Components).
            </p>
            <span className="text-sm font-medium text-brand-400 group-hover:text-brand-300">View Documentation &rarr;</span>
          </Link>

          {/* Card 2: App MVP */}
          <Link to="/login" className="group relative block p-8 bg-slate-800 rounded-2xl border border-slate-700 hover:border-brand-500 transition-all duration-300 hover:shadow-2xl hover:shadow-brand-900/20 text-left">
            <div className="absolute top-6 right-6 p-2 bg-slate-700 rounded-lg text-slate-300 group-hover:text-white group-hover:bg-brand-600 transition-colors">
              <ChevronRight size={20} />
            </div>
            <div className="w-12 h-12 bg-brand-500/10 rounded-xl flex items-center justify-center mb-6">
              <LogIn className="text-brand-400" size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Part III: The Application</h2>
            <p className="text-slate-400 mb-6">
              Full flow: Login &rarr; Dashboard &rarr; Real Editor with Persistence.
            </p>
            <span className="text-sm font-medium text-brand-400 group-hover:text-brand-300">Launch App &rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function App(): React.ReactElement {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/intro" element={<Home />} />
          <Route path="/style-library" element={<StyleLibrary />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/settings" element={
            <ProtectedRoute>
              <UserSettings />
            </ProtectedRoute>
          } />
          {/* Add :bookId parameter to know which book is being edited */}
          <Route path="/books/:bookId/settings" element={
            <ProtectedRoute>
              <CharacterSettings />
            </ProtectedRoute>
          } />
          <Route path="/books/:bookId/relationships" element={
            <ProtectedRoute>
              <RelationshipMap />
            </ProtectedRoute>
          } />
          <Route path="/books/:bookId/foreshadowing" element={
            <ProtectedRoute>
              <Foreshadowing />
            </ProtectedRoute>
          } />
          <Route path="/books/:bookId/story-outline" element={
            <ProtectedRoute>
              <StoryOutline />
            </ProtectedRoute>
          } />
          <Route path="/books/:bookId/ai-brainstorm" element={
            <ProtectedRoute>
              <AiBrainstorm />
            </ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/editor/:bookId" element={
            <ProtectedRoute>
              <Editor />
            </ProtectedRoute>
          } />
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}

export default App;
