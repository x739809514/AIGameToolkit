import bpy, json, sys, math
args=json.loads(sys.argv[sys.argv.index('--')+1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=args['source'], anim_offset=0.0)
scene=bpy.context.scene
objects=list(scene.objects)
actions=list(bpy.data.actions)
name=args['clipName']
matches=[a for a in actions if a.name==name or a.name.endswith('|'+name)]
if len(matches)!=1:
    if len(actions)==1: matches=actions
    else: raise RuntimeError('Cannot uniquely select source animation: '+name)
action=matches[0]
animated=[o for o in objects if o.animation_data and o.animation_data.action]
for obj in animated:
    if obj.type=='ARMATURE': obj.animation_data.action=action
fps=scene.render.fps
origin=0.0; end=float(action.frame_range[1])
if origin+args['out']*fps>end+0.1: raise RuntimeError('Trim exceeds source animation')
duration=(args['out']-args['in'])/args['rate']
count=max(1,math.ceil(duration*30))
samples=[]
for i in range(count+1):
    frame=origin+(args['in']+duration*i/count*args['rate'])*fps
    scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
    samples.append([(obj.matrix_basis.copy(),[bone.matrix_basis.copy() for bone in obj.pose.bones] if obj.type=='ARMATURE' else []) for obj in animated])
for obj in objects:
    obj.animation_data_clear()
    if obj.type=='ARMATURE':
        for bone in obj.pose.bones: bone.rotation_mode='QUATERNION'
for i,sample in enumerate(samples):
    for obj,(matrix,bones) in zip(animated,sample):
        obj.rotation_mode='QUATERNION'
        obj.location,obj.rotation_quaternion,obj.scale=matrix.decompose()
        for channel in ('location','rotation_quaternion','scale'): obj.keyframe_insert(channel,frame=i)
        if obj.type=='ARMATURE':
            for bone,matrix in zip(obj.pose.bones,bones):
                bone.location,bone.rotation_quaternion,bone.scale=matrix.decompose()
                for channel in ('location','rotation_quaternion','scale'): bone.keyframe_insert(channel,frame=i,group=bone.name)
scene.render.fps=30
scene.render.fps_base=30*duration/count
scene.frame_start=0;scene.frame_end=count;scene.frame_set(0)
bpy.ops.export_scene.fbx(filepath=args['target'],use_selection=False,object_types={'ARMATURE','MESH','EMPTY'},add_leaf_bones=False,bake_anim=True,bake_anim_use_all_bones=True,bake_anim_use_nla_strips=False,bake_anim_use_all_actions=False,bake_anim_force_startend_keying=True,bake_anim_step=1.0,bake_anim_simplify_factor=0.0)
