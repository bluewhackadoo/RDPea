import { Routes, Route } from 'react-router-dom';
import { TitleBar } from './components/TitleBar';
import { Dashboard } from './components/Dashboard';
import { SessionView } from './components/SessionView';
import { UpdateNotification } from './components/UpdateNotification';

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-surface-950 overflow-hidden">
      <TitleBar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:connectionId" element={<SessionView />} />
      </Routes>
      <UpdateNotification />
    </div>
  );
}
