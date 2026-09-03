import type { Application } from 'pixi.js';
import { AudioManager } from '../audio/AudioManager';
import { loadEngine } from '../wasm/EngineBridge';
import { ASSET_MANIFEST, resolveAssetUrl } from './assetManifest';
import { preloadPieceIcons } from '../renderers/PieceRenderer';
import { preloadIconBlobs } from '../utils/iconAssetCache';
import type { LoadingTask } from './LoadingCoordinator';

export interface StartupResources {
  app: Application;
}

export function createStartupTasks(
  initPixi: () => Promise<Application>,
  resources: Partial<StartupResources>,
): readonly LoadingTask[] {
  return [
    {
      id: 'pixi',
      label: 'Rendering engine',
      weight: 25,
      required: true,
      run: async () => { resources.app = await initPixi(); },
    },
    {
      id: ASSET_MANIFEST.engine.id,
      label: 'Awakening board',
      weight: 35,
      required: ASSET_MANIFEST.engine.required,
      run: loadEngine,
    },
    {
      id: 'critical-icons',
      label: 'Forging pieces',
      weight: 30,
      required: true,
      run: async () => {
        // preloadPieceIcons: 单一数据源——fetch → blob → 同时构建 PIXI Texture（棋盘）
        // 与填充 DOM blob 缓存（手牌 piece 图标）。iconLoadPromise 守卫使战斗页二次调用零开销。
        // preloadIconBlobs: item + box 图标只需 DOM blob 缓存（无 PIXI Texture 需求）。
        // loong_64 在两边都出现，fetchIconBlobUrl 的 in-flight 去重保证只 fetch 一次。
        await Promise.all([
          preloadPieceIcons(),
          preloadIconBlobs([
            ...ASSET_MANIFEST.itemIcons.map((asset) => resolveAssetUrl(asset.path)),
            resolveAssetUrl('icons/box_64.png'),
          ]),
        ]);
      },
    },
    {
      id: ASSET_MANIFEST.audio.id,
      label: 'Harmonizing sounds',
      weight: 10,
      required: ASSET_MANIFEST.audio.required,
      run: () => AudioManager.getInstance().initialize(),
    },
  ];
}
