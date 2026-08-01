import type {
  AssetDeleteInput,
  AssetPutInput,
  AssetRecord,
  AssetScope,
} from '../domain/assets.js';
import type { AdapterDescriptor } from './common.js';

export interface AssetProvider extends AdapterDescriptor {
  put(input: AssetPutInput): Promise<AssetRecord>;
  list(scope: AssetScope): Promise<readonly AssetRecord[]>;
  delete(input: AssetDeleteInput): Promise<void>;
}
