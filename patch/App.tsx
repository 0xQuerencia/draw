import { Excalidraw } from '@excalidraw/excalidraw';
import TabBar from './components/TabBar';
import CanvasExtras from './components/CanvasExtras';
import CanvasComments from './components/CanvasComments';
import { useExcalidrawSync } from './hooks/useExcalidrawSync';

export default function App() {
  const { excalidrawProps, live } = useExcalidrawSync();
  return <><TabBar live={live} /><Excalidraw {...excalidrawProps} /><CanvasExtras live={live} /><CanvasComments live={live} /></>;
}
