import { Routes, Route, useLocation } from 'react-router-dom';
import { TitleBar } from './components/TitleBar';
import { Dashboard } from './components/Dashboard';
import { SessionView } from './components/SessionView';

export default function App() {
  const location = useLocation();
  const isSession = location.pathname.startsWith('/session/');

  return (
    <div className="h-screen w-screen flex flex-col bg-surface-950 overflow-hidden">
      {!isSession && <TitleBar />}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:connectionId" element={<SessionView />} />
      </Routes>
    </div>
  );
}
