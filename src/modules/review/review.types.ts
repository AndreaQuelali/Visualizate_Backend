import type { OverrideProp } from '../piece/piece-overrides';

export type Category = 'LEGIBILITY' | 'COMPOSITION' | 'CONTENT' | 'BRAND';
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Source = 'RULE' | 'AI';

/** A change that can be applied (and reverted) deterministically. */
export type Patch =
  | { kind: 'piece_data'; fieldKey: string; from: string; to: string }
  | {
      kind: 'layer_prop';
      layerId: string;
      prop: OverrideProp;
      from: unknown;
      to: unknown;
    };

export interface ReviewFinding {
  category: Category;
  severity: Severity;
  source: Source;
  title: string;
  explanation: string;
  target: { layerId?: string; fieldKey?: string } | null;
  patch: Patch | null;
}

export interface BrandInfo {
  colors: Array<{ id: string; name: string; hex: string }>;
  fonts: Array<{ id: string; family: string }>;
}
