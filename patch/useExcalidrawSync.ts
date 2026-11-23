import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { useExcalidrawFilesStore } from '../store/excalidrawFiles';
import { useLiveRoom } from './useLiveRoom';

export const useExcalidrawSync = () => {
  const { currentTabId, updateTab, theme } = useAppStore();
  const { setFiles, getFiles } = useExcalidrawFilesStore();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const switching = useRef(false);
  const live = useLiveRoom(api, currentTabId);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    if (!api) return;
    const tab = useAppStore.getState().tabs.find(t => t.id === currentTabId);
    if (!tab) return;
    if (live.room && currentTabId === live.roomTab && !live.hydrated) return;
    let cancelled = false;
    switching.current = true;
    void getFiles().then(files => {
      if (cancelled || (live.room && currentTabId === live.roomTab && !live.hydrated)) return;
      api.updateScene({
        elements: tab.elements,
        appState: { ...tab.appState, theme } as Parameters<ExcalidrawImperativeAPI['updateScene']>[0]['appState']
      });
      if (Object.keys(files).length) api.addFiles(Object.values(files));
      setTimeout(() => { switching.current = false; }, 120);
    });
    return () => { cancelled = true; switching.current = false; };
  }, [api, currentTabId, theme, getFiles, live.room, live.roomTab, live.hydrated]);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (switching.current || live.isApplyingRemote()) return;
    const active = useAppStore.getState().currentTabId;
    updateTab(active, {
      elements,
      appState: { viewBackgroundColor: state.viewBackgroundColor, zoom: state.zoom, scrollX: state.scrollX, scrollY: state.scrollY }
    });
    void setFiles(files);
    live.sceneChanged(elements, files);
    live.sendView(state);
  }, [updateTab, setFiles, live]);

  return { live, excalidrawProps: {
    excalidrawAPI: setApi,
    theme,
    onChange,
    onPointerUpdate: ({ pointer }: { pointer: { x: number; y: number } }) => live.sendPointer(pointer),
    initialData: async () => {
      const store = useAppStore.getState();
      const tab = store.tabs.find(t => t.id === store.currentTabId) || store.tabs[0];
      return { elements: tab?.elements || [], appState: { ...tab?.appState, theme }, files: await getFiles() };
    }
  } };
};
