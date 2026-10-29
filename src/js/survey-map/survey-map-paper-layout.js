/** v0.1.10.21 新規調査図の編集可能な初期オブジェクト。内部座標100=1mm。 */
import {materialPalette} from './survey-map-labels.js';
import {defaultShapeParams} from './survey-map-shapes.js';

export function paperLayoutFields(drawing){
  const rect=(role,x,y,width,height,text,extra={})=>({
    type:'shape',shapeType:'rect',shapeParams:defaultShapeParams('rect'),
    paperRole:role,x,y,width,height,rotation:0,text,
    fontSize:7,textColor:'#111111',alignH:'center',alignV:'middle',
    paddingTop:0,paddingRight:0,paddingBottom:0,paddingLeft:0,
    lineEnabled:false,strokeColor:'#111111',strokeWidth:40,
    fillEnabled:false,fillColor:'#ffffff',fillOpacity:1,...extra
  });
  const group='legend';
  const objects=[
    rect('title',500,1500,3500,750,drawing.titleSettings?.text||'調査図',{fontSize:14}),
    rect('name',500,19500,8000,600,drawing.nameSettings?.text||drawing.name||'',{fontSize:9}),
    {
      type:'shape',paperRole:'legendFrame',legendGroupId:group,
      x:24750,y:17000,width:4500,height:3500,rotation:0,
      shapeType:'rect',shapeParams:defaultShapeParams('rect'),
      fillEnabled:false,fillColor:'#ffffff',fillOpacity:0,
      lineEnabled:true,strokeColor:'#111111',strokeWidth:35
    },
    {
      type:'shape',shapeType:'circle',shapeParams:defaultShapeParams('circle'),
      sampleRole:'marker',paperRole:'legendSample',legendGroupId:group,
      x:26000,y:17317,width:400,height:400,rotation:0,
      fillEnabled:true,fillColor:'#dc2626',fillOpacity:1,
      lineEnabled:false,strokeColor:'#dc2626',strokeWidth:40
    },
    rect('legendSampleCaption',27000,17250,2000,500,'採取位置',{legendGroupId:group})
  ];
  const rows=[
    {kind:'none',role:'legendMaterialNone',caption:'含有なし',y:18000,labelX:27250},
    {kind:'positive',role:'legendMaterialPositive',caption:'含有',y:18750,labelX:27268},
    {kind:'assumed',role:'legendMaterialAssumed',caption:'みなし',y:19500,labelX:27250}
  ];
  for(const row of rows){
    const palette=materialPalette(row.kind);
    objects.push(rect(row.role,25250,row.y,2000,600,'建材No. 建材名称',{
      legendGroupId:group,materialKind:row.kind,fontSize:6,alignH:'left',
      paddingTop:50,paddingRight:50,paddingBottom:50,paddingLeft:50,
      lineEnabled:true,strokeColor:palette.strokeColor,
      fillEnabled:Boolean(palette.backgroundEnabled),fillColor:palette.backgroundColor,
      textColor:palette.textColor
    }));
    objects.push(rect(row.role+'Caption',row.labelX,row.y,1500,600,row.caption,{
      legendGroupId:group,fontSize:7
    }));
  }
  return objects;
}
