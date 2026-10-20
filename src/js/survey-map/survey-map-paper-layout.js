/** v0.1.10.18 調査図の独立した表示・定義モジュール。 */
import {LABEL_DEFAULTS,materialPalette} from './survey-map-labels.js';
import {defaultShapeParams} from './survey-map-shapes.js';

export function paperLayoutFields(drawing){
  const make=(type,role,x,y,width,height,text,extra={})=>({
    ...LABEL_DEFAULTS[type]||LABEL_DEFAULTS.text,
    type,paperRole:role,x,y,width,height,text,...extra
  });
  const objects=[];
  objects.push(make('text','title',2500,1500,4200,900,drawing.titleSettings?.text||'調査図',
    {fontSize:14}));
  objects.push(make('text','name',2500,19400,9000,650,drawing.nameSettings?.text||drawing.name||'',
    {fontSize:9}));
  const group='legend';
  objects.push({type:'shape',paperRole:'legendFrame',legendGroupId:group,
    x:21600,y:15000,width:7300,height:5300,shapeType:'rect',shapeParams:defaultShapeParams('rect'),
    fillEnabled:false,fillColor:'#ffffff',fillOpacity:0,lineEnabled:true,strokeColor:'#111111',strokeWidth:35});
  objects.push(make('text','legendHeading',22000,15300,1900,450,'凡例',
    {legendGroupId:group,fontSize:8}));
  const rows=[
    ['positive','含有','建材No.1-①\n壁 仕上塗材A'],
    ['assumed','含有みなし','建材No.2\n壁 仕上塗材B'],
    ['none','含有なし','建材No.3-①\n壁 仕上塗材C']
  ];
  for(let i=0;i<rows.length;i++){
    const [kind,label,text]=rows[i],y=16000+i*1120;
    objects.push(make('materialLabel','legendMaterial'+i,22000,y,2000,600,text,{
      legendGroupId:group,materialKind:kind,...materialPalette(kind)
    }));
    objects.push(make('text','legendCaption'+i,24200,y+80,4000,450,label,{
      legendGroupId:group,fontSize:6
    }));
  }
  objects.push(make('sampleMarker','legendSample',22100,19400,400,400,'①',{
    legendGroupId:group
  }));
  objects.push(make('text','legendSampleCaption',24200,19350,4200,500,'採取位置',{
    legendGroupId:group,fontSize:6
  }));
  return objects;
}
