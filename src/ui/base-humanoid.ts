import type * as THREE from 'three';
export const humanoidNames=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'] as const;
export type HumanoidName=typeof humanoidNames[number];
export interface BaseHumanoid {group:THREE.Group;mesh:THREE.SkinnedMesh;bones:Record<HumanoidName,THREE.Bone>}
