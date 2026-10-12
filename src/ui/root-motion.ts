import {AnimationClip,Object3D,PropertyBinding,type Bone} from 'three';

// Only pin the character's root/hips translation. Limb position tracks,
// root rotations and scale remain part of the original performance.
export function createInPlaceClip(model:Object3D,source:AnimationClip):AnimationClip {
  const clip=source.clone();
  for(const track of clip.tracks){
    const binding=PropertyBinding.parseTrackName(track.name);
    if(binding.propertyName!=='position'||binding.objectName)continue;
    const node=PropertyBinding.findNode(model,binding.nodeName||model.uuid) as Object3D|null;
    if(!node)continue;
    let boneAncestor=false;for(let parent=node.parent;parent&&parent!==model;parent=parent.parent)if((parent as Bone).isBone)boneAncestor=true;
    let containsCharacter=false;node.traverse(child=>{if((child as Bone).isBone||'isMesh' in child)containsCharacter=true;});
    const root=node===model||(!boneAncestor&&containsCharacter);
    const hips=(node as Bone).isBone&&/hips|pelvis/i.test(node.name);
    if(!root&&!hips)continue;
    const stride=track.getValueSize(),anchor=track.values.slice(0,stride);
    for(let offset=0;offset<track.values.length;offset+=stride)track.values.set(anchor,offset);
  }
  return clip;
}
