import { type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
}

export default function Drawer({ children, onClose }: Props) {
  return (
    <>
      <div className="sf-scrim" onClick={onClose} />
      <aside className="sf-drawer" role="dialog" aria-modal="true">
        {children}
      </aside>
    </>
  );
}
