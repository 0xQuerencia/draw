import { useEffect, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import TabBar from './components/TabBar';
import CanvasExtras from './components/CanvasExtras';
import CanvasComments from './components/CanvasComments';
import RoomDashboard from './components/RoomDashboard';
import { useExcalidrawSync } from './hooks/useExcalidrawSync';

const editorRoute = () => location.hash === '#local' || /^#room=[a-f0-9]{32}$/.test(location.hash);

export default function App() {
  const [editor, setEditor] = useState(editorRoute);
  const { excalidrawProps, live } = useExcalidrawSync();
  useEffect(() => {
    const changed = () => setEditor(editorRoute());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return editor
    ? <><TabBar live={live} /><Excalidraw {...excalidrawProps} /><CanvasExtras live={live} /><CanvasComments live={live} /></>
    : <RoomDashboard />;
}
