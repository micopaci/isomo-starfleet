import { useNavigate, useLocation } from 'react-router-dom';

const ITEMS = [
  { path: '/overview',  label: 'Overview',  icon: 'ti-layout-dashboard' },
  { path: '/alerts',    label: 'Alerts',    icon: 'ti-bell' },
  { path: '/starlinks', label: 'Links',     icon: 'ti-antenna' },
  { path: '/computers', label: 'Devices',   icon: 'ti-device-laptop' },
  { path: '/inventory', label: 'Intake',    icon: 'ti-package' },
  { path: '/campuses',  label: 'Sites',     icon: 'ti-school' },
] as const;

export default function BottomNav() {
  const loc = useLocation();
  const nav = useNavigate();

  function isActive(path: string) {
    return loc.pathname === path || (path === '/overview' && loc.pathname === '/');
  }

  return (
    <nav className="sf-bottom-nav" aria-label="Mobile navigation">
      {ITEMS.map(item => (
        <button
          key={item.path}
          className={`sf-bottom-nav-item${isActive(item.path) ? ' is-active' : ''}`}
          onClick={() => nav(item.path)}
          aria-current={isActive(item.path) ? 'page' : undefined}
          aria-label={item.label}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}
