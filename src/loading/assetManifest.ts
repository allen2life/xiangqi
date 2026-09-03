export type AssetKind = 'image' | 'audio' | 'wasm';

export interface AssetManifestEntry {
  readonly id: string;
  readonly kind: AssetKind;
  readonly path: string;
  readonly required: boolean;
}

const pieceIconFiles = [
  'pawn_64.png', 'pawn_enemy_64.png',
  'chariot_64.png',
  'cannon_64.png', 'cannon_enemy_64.png',
  'horse_64.png',
  'elephant_64.png', 'elephant_enemy_64.png',
  'advisor_64.png', 'advisor_enemy_64.png',
  'general_64.png', 'general_enemy_64.png',
  'loong_64.png',
] as const;

const itemIconFiles = [
  'undo_64.png', 'redraw_64.png', 'unseal_64.png', 'handset_64.png', 'loong_64.png', 'loong_soul_64.png',
] as const;

export const ASSET_MANIFEST = {
  engine: {
    id: 'engine-wasm',
    kind: 'wasm',
    path: 'xiangqiblast-engine.wasm',
    required: true,
  },
  pieceIcons: pieceIconFiles.map((file) => ({
    id: `piece-${file}`,
    kind: 'image' as const,
    path: `icons/${file}`,
    required: file !== 'loong_64.png',
  })),
  itemIcons: itemIconFiles.map((file) => ({
    id: `item-${file}`,
    kind: 'image' as const,
    path: `icons/${file}`,
    required: file !== 'loong_64.png',
  })),
  audio: {
    id: 'audio-runtime',
    kind: 'audio',
    path: 'audio/',
    required: false,
  },
} as const satisfies {
  engine: AssetManifestEntry;
  pieceIcons: readonly AssetManifestEntry[];
  itemIcons: readonly AssetManifestEntry[];
  audio: AssetManifestEntry;
};

/** Resolve a public asset without assuming that the app is deployed at `/`. */
export function resolveAssetUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.replace(/^\/+/, '')}`;
}

export const CRITICAL_ICON_ASSETS: readonly AssetManifestEntry[] = [
  ...ASSET_MANIFEST.pieceIcons,
  ...ASSET_MANIFEST.itemIcons,
];
