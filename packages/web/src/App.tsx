import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import Shell from './layouts/Shell';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Starlinks from './pages/Starlinks';
import Alerts from './pages/Alerts';
import Campuses from './pages/Campuses';
import MapView from './pages/MapView';
import Inventory from './pages/Inventory';
import FleetReport from './pages/FleetReport';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuth = localStorage.getItem('sf_auth') === 'true';
  const loc = useLocation();
  if (!isAuth && loc.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<AuthGuard><Shell /></AuthGuard>}>
              <Route index element={<Navigate to="/overview" replace />} />
              <Route path="overview"   element={<Overview />} />
              <Route path="starlinks"  element={<Starlinks />} />
              <Route path="computers"  element={<Navigate to="/inventory" replace />} />
              <Route path="alerts"     element={<Alerts />} />
              <Route path="campuses"   element={<Campuses />} />
              <Route path="map"        element={<MapView />} />
              <Route path="inventory"  element={<Inventory />} />
              <Route path="report"     element={<FleetReport />} />
              <Route path="*"          element={<Navigate to="/overview" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </DataProvider>
    </ThemeProvider>
  );
}
