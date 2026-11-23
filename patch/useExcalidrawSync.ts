import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // Excalidraw calls onChange during tool/zoom transitions. Keep these handler
  // references stable across Zustand updates to avoid re-subscribing on every change.
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
  }, [updateTab, setFiles, live.isApplyingRemote, live.sceneChanged, live.sendView]);

  const onPointerUpdate = useCallback(
    ({ pointer }: { pointer: { x: number; y: number } }) => live.sendPointer(pointer),
    [live.sendPointer],
  );

  const initialData = useCallback(async () => {
    const store = useAppStore.getState();
    const tab = store.tabs.find(t => t.id === store.currentTabId) || store.tabs[0];
    return { elements: tab?.elements || [], appState: { ...tab?.appState, theme }, files: await getFiles() };
  }, [theme, getFiles]);

  const excalidrawProps = useMemo(() => ({
    excalidrawAPI: setApi,
    theme,
    onChange,
    onPointerUpdate,
    initialData,
  }), [theme, onChange, onPointerUpdate, initialData]);

  return { live, excalidrawProps };
};
