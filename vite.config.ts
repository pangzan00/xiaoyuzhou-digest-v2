import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import sourceManifest from './manifest.json';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CSS 文件已通过 src/styles/index.css 的 @import 由 Vite 打包并走 HMR，
// 不应再作为静态目录复制 + 触发 crx:runtime-reload（会导致扩展整体重载、
// 侧边栏关闭，破坏热更新）。只保留真正需要 chrome.runtime.getURL 的静态资源。
const STATIC_DIRECTORIES = ['icons', 'assets', 'prompts'] as const;

/**
 * The root manifest remains usable when this repository is loaded directly,
 * while CRXJS receives source entry paths and emits the dist-relative manifest.
 */
const manifest = {
  ...stripDistPrefix(sourceManifest),
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module' as const,
  },
  content_scripts: [{
    matches: ['https://www.xiaoyuzhoufm.com/*'],
    js: ['src/content/index.ts'],
    run_at: 'document_idle',
  }],
};

export default defineConfig({
  plugins: [
    react(),
    ...crx({ manifest, liveReload: true }),
    copyExtensionStaticAssets(),
    emitStableEntryPoints(),
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
      '@shared': resolve(projectRoot, 'src/shared'),
      '@components': resolve(projectRoot, 'src/components'),
      '@hooks': resolve(projectRoot, 'src/hooks'),
      '@utils': resolve(projectRoot, 'src/utils'),
      '@types': resolve(projectRoot, 'src/types'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 开发模式由 Vite 提供可读源码与 HMR；正式扩展不携带 source map，避免将其作为运行时资源发布。
    sourcemap: false,
  },
});

/** Remove the root manifest's development-only dist/ prefix for CRXJS inputs. */
function stripDistPrefix<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/^dist\//, '') as T;
  if (Array.isArray(value)) return value.map(stripDistPrefix) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stripDistPrefix(item)])
    ) as T;
  }
  return value;
}

/**
 * CRXJS copies manifest-declared files itself. These runtime and legacy
 * resources are addressed by chrome.runtime.getURL(), so copy them alongside
 * the extension in both build and dev modes.
 */
function copyExtensionStaticAssets(): Plugin {
  let config: ResolvedConfig;

  const outputDirectory = () => (
    isAbsolute(config.build.outDir)
      ? config.build.outDir
      : resolve(config.root, config.build.outDir)
  );

  const copyAll = () => {
    const outputDir = outputDirectory();
    for (const directory of STATIC_DIRECTORIES) {
      const sourceDir = resolve(config.root, directory);
      if (existsSync(sourceDir)) copyDir(sourceDir, join(outputDir, directory));
    }

    const optionsCss = resolve(config.root, 'options.css');
    if (existsSync(optionsCss)) copyFile(optionsCss, join(outputDir, 'options.css'));
  };

  const outputPathFor = (filePath: string) => {
    const optionsCss = resolve(config.root, 'options.css');
    if (filePath === optionsCss) return join(outputDirectory(), 'options.css');

    for (const directory of STATIC_DIRECTORIES) {
      const sourceDir = resolve(config.root, directory);
      const fileRelativePath = relative(sourceDir, filePath);
      if (fileRelativePath && !fileRelativePath.startsWith('..') && !isAbsolute(fileRelativePath)) {
        return join(outputDirectory(), directory, fileRelativePath);
      }
    }

    return null;
  };

  const syncStaticFile = (filePath: string) => {
    const outputPath = outputPathFor(filePath);
    if (!outputPath) return;

    if (existsSync(filePath) && statSync(filePath).isFile()) copyFile(filePath, outputPath);
    else rmSync(outputPath, { force: true });
  };

  return {
    name: 'xiaoyuzhou-digest-static-assets',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    configureServer(server) {
      copyAll();
      server.watcher.add([
        ...STATIC_DIRECTORIES.map((directory) => resolve(config.root, directory)),
        resolve(config.root, 'options.css'),
      ]);
      const updateStaticAsset = (filePath: string) => {
        syncStaticFile(filePath);
        server.ws.send({ type: 'custom', event: 'crx:runtime-reload' });
      };
      server.watcher.on('add', updateStaticAsset);
      server.watcher.on('change', updateStaticAsset);
      server.watcher.on('unlink', updateStaticAsset);
    },
    closeBundle() {
      if (config.command === 'build') copyAll();
    },
  };
}

/**
 * CRXJS emits hashed loader chunks (service-worker-loader.js,
 * assets/index.ts-loader-<hash>.js), but the root manifest — used when the
 * repository itself is loaded as an unpacked extension — references stable
 * paths dist/background.js and dist/content.js. Re-emit those entry points
 * after every build so both loading styles keep working.
 */
function emitStableEntryPoints(): Plugin {
  let config: ResolvedConfig;
  const outputDir = () =>
    isAbsolute(config.build.outDir)
      ? config.build.outDir
      : resolve(config.root, config.build.outDir);

  return {
    name: 'xiaoyuzhou-digest-stable-entry-points',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    closeBundle() {
      if (config.command !== 'build') return;

      const destination = outputDir();
      const serviceWorkerLoader = join(destination, 'service-worker-loader.js');
      if (existsSync(serviceWorkerLoader)) {
        copyFileSync(serviceWorkerLoader, join(destination, 'background.js'));
      }

      const assetsDir = join(destination, 'assets');
      if (existsSync(assetsDir)) {
        const contentLoader = readdirSync(assetsDir).find((file) =>
          /-loader-[A-Za-z0-9_-]+\.js$/.test(file)
        );
        if (contentLoader) {
          copyFileSync(join(assetsDir, contentLoader), join(destination, 'content.js'));
        }
      }
    },
  };
}

function copyDir(sourceDir: string, destinationDir: string): void {
  mkdirSync(destinationDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, destinationPath);
    else copyFile(sourcePath, destinationPath);
  }
}

function copyFile(sourcePath: string, destinationPath: string): void {
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}
