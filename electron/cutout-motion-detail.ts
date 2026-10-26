const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),number={type:'number'},string={type:'string'};
const wave={channel:{type:'string',enum:['x','y','scaleX','scaleY','rotation']},offset:number,amplitude:number,cycles:{type:'integer'},delay:number,wave:{type:'string',enum:['sine','breath']},peak:number};
export const detailSchemas=[
 object({tool:{type:'string',enum:['animate_channel']},target:{type:'string',enum:['bone','part']},targetId:string,...wave}),
 object({tool:{type:'string',enum:['animate_region']},regionId:string,partId:string,centerX:number,centerY:number,radiusX:number,radiusY:number,falloff:{type:'string',enum:['radial','tip']},...wave})
];
// One entry controls one channel, so a multi-part breathing motion can exceed 12.
// Keep the requested output and local validation on the same bounded budget.
export const motionDetailLimit=32;
export const motionDetailsSchema={type:'array',items:{anyOf:detailSchemas},maxItems:motionDetailLimit};
export const motionDetailsInstructions=`details 必须为数组，最多 ${motionDetailLimit} 条局部动画通道；同一部位的位移、旋转、横向缩放和纵向缩放分别计一条。优先安排用户要求的胸腹、肩膀、头部与配件细节，同一目标的同一通道不要重复。无需局部细节时返回 []，不能返回 null 或对象。`;
export const detailInstructions=`局部动画工具：animate_channel 精确替换某根骨骼或某个部件的单一轨道，target=bone/part，targetId 必须存在，channel=x/y/scaleX/scaleY/rotation。animate_region 为已有网格部件添加局部形变，胸腹在同一张图上也可独立运动；regionId 使用稳定英文ID（如 chest-breath、belly-breath、cape-follow），修改已有区域时复用ID与范围，只改指定通道。centerX/Y、radiusX/Y 为相对 partBounds 的归一化中心和半径，中心0–1，半径0.05–2；falloff=radial 从中心平滑衰减，适合胸腹；tip 从centerY处固定到向下radiusY处逐渐增强，适合上端固定的披风。两种工具均使用 offset（位移/旋转默认0，缩放默认1）、amplitude（有符号变化量，缩放建议0.02–0.12）、cycles（整段1–8次）、delay（相对周期起点延迟秒数，0至duration）、wave=sine或breath、peak（breath吸气到峰值所占周期比例0.15–0.85，通常0.4）。正旋转顺时针，y负值上移；breath从0上升至1再回0，sine正负摆动；非循环自动淡入淡出。呼吸用胸/腹局部缩放，肩膀轻抬，头晚0.1–0.3秒，披风晚0.2–0.5秒；只有用户需要时才增加配件运动。骨骼位移会带动子节点，避免同时对父子重复加同一运动；不要让全角色缩放代替胸腹呼吸，不要让脚离地。现有网格和区域定义会在上下文提供；不需要用户手动找参数。锁定部件不得修改或被骨骼间接带动。针对单个部位的修改优先使用这两个工具，保留其他动作。`;
