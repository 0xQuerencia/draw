import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const pin = '8baffcc29e9b850108213d27c2b8f27d0ee9ac78';
fs.rmSync('upstream', { recursive: true, force: true });
run('git', ['clone', '--depth', '1', 'https://github.com/MontejoJorge/excalidraw-multi-tabs.git', 'upstream']);
run('git', ['fetch', '--depth', '1', 'origin', pin], { cwd: 'upstream' });
run('git', ['checkout', '--detach', pin], { cwd: 'upstream' });

const overrides = {
  'patch/App.tsx': 'src/App.tsx',
  'patch/useExcalidrawSync.ts': 'src/hooks/useExcalidrawSync.ts',
  'patch/useLiveRoom.ts': 'src/hooks/useLiveRoom.ts',
  'patch/LiveControls.tsx': 'src/components/LiveControls.tsx',
  'patch/CanvasExtras.tsx': 'src/components/CanvasExtras.tsx',
};
for (const [source, target] of Object.entries(overrides)) {
  const destination = path.join('upstream', target);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
const file = 'upstream/src/components/TabBar/index.tsx';
let content = fs.readFileSync(file, 'utf8');
const original = "import { useRef } from 'react';";
if (!content.includes(original)) throw new Error('Upstream TabBar import changed');
content = content.replace(original, original + "\nimport type { useLiveRoom } from '../../hooks/useLiveRoom';\nimport LiveControls from '../LiveControls';");
content = content.replace('const TabBar = () => {', "const TabBar = ({ live }: { live: ReturnType<typeof useLiveRoom> }) => {");
const target = '<div className={style.actionsRight}>';
if (!content.includes(target)) throw new Error('Upstream TabBar layout changed');
content = content.replace(target, target + '\n<LiveControls live={live} />');
fs.writeFileSync(file, content);
fs.writeFileSync('upstream/vite.config.ts', "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react()], base: '/' });\n");
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: 'upstream' });
run('npm', ['run', 'build'], { cwd: 'upstream' });
fs.rmSync('public', { recursive: true, force: true });
fs.cpSync('upstream/dist', 'public', { recursive: true });
console.log('Built Draw in public/');
