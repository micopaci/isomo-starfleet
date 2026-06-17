import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

export default function Shell() {
  return (
    <div className="sf-shell">
      <Sidebar />
      <div className="sf-main">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
