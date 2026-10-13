import type * as THREE from 'three';
import type {HumanoidName} from '../shared/humanoid';
export {humanoidNames} from '../shared/humanoid';
export type {HumanoidName} from '../shared/humanoid';
export interface BaseHumanoid {group:THREE.Group;mesh:THREE.SkinnedMesh;bones:Record<HumanoidName,THREE.Bone>}
