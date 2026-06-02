import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import IdePage from './pages/IdePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/ide" element={<IdePage />} />
        <Route path="/" element={<Navigate to="/ide" replace />} />
        <Route path="*" element={<Navigate to="/ide" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
