import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Verify from './pages/Verify.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Timetable from './pages/Timetable.jsx';
import Seating from './pages/admin/Seating.jsx';
import Duties from './pages/admin/Duties.jsx';
import Turnout from './pages/admin/Turnout.jsx';
import DataPage from './pages/admin/DataPage.jsx';
import MyExams from './pages/student/MyExams.jsx';
import MyDuties from './pages/faculty/MyDuties.jsx';

const HOME = { admin: '/admin', faculty: '/faculty', student: '/student' };

function Protected({ role, children }) {
  const { user, checking } = useAuth();
  if (checking) return <div className="p-10 text-center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route path="/verify/:roll" element={<Verify />} />
      <Route path="/admin" element={<Protected role="admin"><Dashboard /></Protected>} />
      <Route path="/admin/timetable" element={<Protected role="admin"><Timetable /></Protected>} />
      <Route path="/admin/seating" element={<Protected role="admin"><Seating /></Protected>} />
      <Route path="/admin/duties" element={<Protected role="admin"><Duties /></Protected>} />
      <Route path="/admin/turnout" element={<Protected role="admin"><Turnout /></Protected>} />
      <Route path="/admin/data" element={<Protected role="admin"><DataPage /></Protected>} />
      <Route path="/student" element={<Protected role="student"><MyExams /></Protected>} />
      <Route path="/student/timetable" element={<Protected role="student"><Timetable /></Protected>} />
      <Route path="/faculty" element={<Protected role="faculty"><MyDuties /></Protected>} />
      <Route path="/faculty/timetable" element={<Protected role="faculty"><Timetable /></Protected>} />
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
