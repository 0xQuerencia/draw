import { Excalidraw } from '@excalidraw/excalidraw';
import TabBar from './components/TabBar';
import { useExcalidrawSync } from './hooks/useExcalidrawSync';

export default function App() {
  const { excalidrawProps, live } = useExcalidrawSync();
  return <><TabBar live={live} /><Excalidraw {...excalidrawProps} /></>;
}
