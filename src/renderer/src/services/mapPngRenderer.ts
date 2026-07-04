export interface MapPngSource {
  title: string;
  backgroundAssetUrl?: string;
  canvasWidth: number;
  canvasHeight: number;
}

interface Point {
  x: number;
  y: number;
}

type RegionGeometry =
  | { shape: 'rect'; x: number; y: number; width: number; height: number; rotation: number }
  | { shape: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number; rotation: number }
  | { shape: 'triangle' | 'hexagon' | 'pentagon'; x: number; y: number; radius: number; rotation: number }
  | { shape: 'diamond'; x: number; y: number; width: number; height: number; rotation: number }
  | { shape: 'polygon'; points: Point[] };

const labelDefaults = { fontSize: 18, color: '#442D1C', backgroundEnabled: true, backgroundColor: '#fff4d4', opacity: 1 };
const routeDefaults = { stroke: '#6f3f24', strokeWidth: 3, lineStyle: 'solid', opacity: 0.9, arrowDirection: 'none', arrowSize: 12 };
const regionDefaults = { fill: '#8f6f3f', fillOpacity: 0.25, stroke: '#6f3f24', strokeWidth: 2, dashEnabled: false, labelVisible: true };

export async function renderSavedMapPng(map: MapPngSource, layerRows: any[], objectRows: any[], pixelRatio: 1 | 2): Promise<string> {
  const width = Number(map.canvasWidth || 1600);
  const height = Number(map.canvasHeight || 1000);
  const outputWidth = width * pixelRatio;
  const outputHeight = height * pixelRatio;
  if (outputWidth > 16384 || outputHeight > 16384 || outputWidth * outputHeight > 64_000_000) {
    throw new Error(`地图“${map.title || '未命名地图'}”导出尺寸 ${outputWidth} × ${outputHeight} 像素过大。请改用 1x。`);
  }

  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(outputWidth);
  canvas.height = Math.round(outputHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境无法创建 PNG 画布。');
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#f8edcf';
  context.fillRect(0, 0, width, height);

  if (map.backgroundAssetUrl) {
    const image = await loadImage(map.backgroundAssetUrl);
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    if (image instanceof ImageBitmap) image.close();
  }

  const layers = layerRows
    .map((layer, index) => ({
      id: String(layer.id),
      visible: Boolean(layer.visible),
      opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
      sortOrder: Number(layer.sortOrder ?? index)
    }))
    .filter((layer) => layer.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const layer of layers) {
    const objects = objectRows.filter((object) => String(object.layerId || '') === layer.id);
    objects.filter((object) => object.type === 'region').forEach((object) => drawRegion(context, object, layer.opacity));
    objects.filter((object) => object.type === 'route').forEach((object) => drawRoute(context, object, layer.opacity));
    objects.filter((object) => object.type === 'label').forEach((object) => drawLabel(context, object, layer.opacity));
    objects.filter((object) => !['region', 'route', 'label'].includes(object.type)).forEach((object) => drawMarker(context, object, layer.opacity));
  }
  return canvas.toDataURL('image/png');
}

async function loadImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`底图读取失败（${response.status}）。`);
    return await createImageBitmap(await response.blob());
  } catch (cause) {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(cause instanceof Error ? cause : new Error('底图读取失败。'));
      image.src = url;
    });
  }
}

function drawRegion(context: CanvasRenderingContext2D, object: any, layerOpacity: number): void {
  const geometry = normalizeGeometry(parseJson(object.geometryJson), Number(object.x || 0), Number(object.y || 0));
  const style = { ...regionDefaults, ...parseJson(object.styleJson) };
  context.save();
  beginRegionPath(context, geometry);
  context.fillStyle = style.fill;
  context.globalAlpha = clamp(Number(style.fillOpacity), 0, 1) * layerOpacity;
  context.fill();
  context.strokeStyle = style.stroke;
  context.lineWidth = clamp(Number(style.strokeWidth), 1, 100);
  context.setLineDash(style.dashEnabled ? [8, 6] : []);
  context.globalAlpha = layerOpacity;
  context.stroke();
  context.restore();

  if (style.labelVisible) {
    const point = regionCenter(geometry);
    context.save();
    context.globalAlpha = layerOpacity;
    context.fillStyle = '#442D1C';
    context.font = '600 18px serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(object.name || '区域'), point.x, point.y);
    context.restore();
  }
}

function drawRoute(context: CanvasRenderingContext2D, object: any, layerOpacity: number): void {
  const geometry = parseJson(object.geometryJson);
  const points = normalizePoints(geometry.points);
  if (points.length < 2) return;
  const rawStyle = parseJson(object.styleJson);
  const style = {
    ...routeDefaults,
    ...rawStyle,
    lineStyle: rawStyle.lineStyle || (rawStyle.dashEnabled ? 'dashed' : 'solid'),
    arrowDirection: rawStyle.arrowDirection || (rawStyle.arrowEnabled ? 'forward' : 'none')
  };
  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.strokeStyle = style.stroke;
  context.fillStyle = style.stroke;
  context.lineWidth = clamp(Number(style.strokeWidth), 1, 100);
  context.lineJoin = 'round';
  context.lineCap = style.lineStyle === 'dotted' ? 'round' : 'butt';
  context.setLineDash(style.lineStyle === 'dashed' ? [12, 8] : style.lineStyle === 'dotted' ? [2, 8] : []);
  context.globalAlpha = clamp(Number(style.opacity), 0, 1) * layerOpacity;
  context.stroke();
  context.setLineDash([]);
  if (style.arrowDirection === 'forward' || style.arrowDirection === 'both') drawArrow(context, points.at(-2)!, points.at(-1)!, Number(style.arrowSize));
  if (style.arrowDirection === 'backward' || style.arrowDirection === 'both') drawArrow(context, points[1], points[0], Number(style.arrowSize));
  context.restore();
}

function drawLabel(context: CanvasRenderingContext2D, object: any, layerOpacity: number): void {
  const properties = parseJson(object.propertiesJson);
  const style = { ...labelDefaults, ...parseJson(object.styleJson) };
  const text = String(properties.text || object.name || '文字标签');
  const x = Number(object.x || 0);
  const y = Number(object.y || 0);
  context.save();
  context.font = `500 ${clamp(Number(style.fontSize), 8, 200)}px serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.globalAlpha = clamp(Number(style.opacity), 0, 1) * layerOpacity;
  const width = context.measureText(text).width + 16;
  const height = Number(style.fontSize) + 12;
  if (style.backgroundEnabled) {
    roundedRect(context, x - width / 2, y - height / 2, width, height, 4);
    context.fillStyle = style.backgroundColor;
    context.fill();
    context.strokeStyle = 'rgba(68,45,28,0.22)';
    context.lineWidth = 1;
    context.stroke();
  }
  context.fillStyle = style.color;
  context.fillText(text, x, y);
  context.restore();
}

function drawMarker(context: CanvasRenderingContext2D, object: any, layerOpacity: number): void {
  const text = String(object.name || object.locationName || '点位');
  const markerX = Number(object.x || 0);
  const markerY = Number(object.y || 0);
  context.save();
  context.font = '500 12px sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.globalAlpha = layerOpacity;
  const width = context.measureText(text).width + 34;
  const height = 25;
  const x = markerX - width / 2;
  const y = markerY - height;
  roundedRect(context, x, y, width, height, 12);
  context.fillStyle = '#f8edcf';
  context.fill();
  context.strokeStyle = '#9a552d';
  context.stroke();
  context.beginPath();
  context.arc(x + 13, y + height / 2, 4, 0, Math.PI * 2);
  context.fillStyle = '#9a552d';
  context.fill();
  context.fillStyle = '#442D1C';
  context.fillText(text, x + 23, y + height / 2);
  context.restore();
}

function normalizeGeometry(value: any, x: number, y: number): RegionGeometry {
  const rotation = normalizeRotation(value.rotation);
  if (value.shape === 'ellipse') return { shape: 'ellipse', x: Number(value.x ?? x), y: Number(value.y ?? y), radiusX: Math.max(10, Number(value.radiusX || 140)), radiusY: Math.max(10, Number(value.radiusY || 85)), rotation };
  if (value.shape === 'triangle' || value.shape === 'hexagon' || value.shape === 'pentagon') return { shape: value.shape, x: Number(value.x ?? x), y: Number(value.y ?? y), radius: Math.max(20, Number(value.radius || 120)), rotation };
  if (value.shape === 'diamond') return { shape: 'diamond', x: Number(value.x ?? x), y: Number(value.y ?? y), width: Math.max(20, Number(value.width || 220)), height: Math.max(20, Number(value.height || 160)), rotation };
  if (value.shape === 'polygon') return { shape: 'polygon', points: normalizePoints(value.points) };
  return { shape: 'rect', x: Number(value.x ?? x), y: Number(value.y ?? y), width: Math.max(20, Number(value.width || 280)), height: Math.max(20, Number(value.height || 160)), rotation };
}

function beginRegionPath(context: CanvasRenderingContext2D, geometry: RegionGeometry): void {
  context.beginPath();
  if (geometry.shape === 'ellipse') {
    context.ellipse(geometry.x, geometry.y, geometry.radiusX, geometry.radiusY, geometry.rotation * Math.PI / 180, 0, Math.PI * 2);
    context.closePath();
    return;
  }
  const points = boundaryPoints(geometry);
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
}

function boundaryPoints(geometry: RegionGeometry): Point[] {
  if (geometry.shape === 'polygon') return geometry.points;
  if (geometry.shape === 'rect') {
    const center = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
    return [{ x: geometry.x, y: geometry.y }, { x: geometry.x + geometry.width, y: geometry.y }, { x: geometry.x + geometry.width, y: geometry.y + geometry.height }, { x: geometry.x, y: geometry.y + geometry.height }].map((point) => rotatePoint(point, center, geometry.rotation));
  }
  if (geometry.shape === 'diamond') {
    return [{ x: geometry.x, y: geometry.y - geometry.height / 2 }, { x: geometry.x + geometry.width / 2, y: geometry.y }, { x: geometry.x, y: geometry.y + geometry.height / 2 }, { x: geometry.x - geometry.width / 2, y: geometry.y }].map((point) => rotatePoint(point, { x: geometry.x, y: geometry.y }, geometry.rotation));
  }
  if (geometry.shape === 'ellipse') return [];
  const count = geometry.shape === 'triangle' ? 3 : geometry.shape === 'hexagon' ? 6 : 5;
  const start = geometry.shape === 'hexagon' ? -30 : -90;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((start + geometry.rotation) * Math.PI / 180) + Math.PI * 2 * index / count;
    return { x: geometry.x + Math.cos(angle) * geometry.radius, y: geometry.y + Math.sin(angle) * geometry.radius };
  });
}

function regionCenter(geometry: RegionGeometry): Point {
  if (geometry.shape === 'rect') return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  if (geometry.shape !== 'polygon') return { x: geometry.x, y: geometry.y };
  if (!geometry.points.length) return { x: 0, y: 0 };
  const total = geometry.points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / geometry.points.length, y: total.y / geometry.points.length };
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, tip: Point, size: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = Math.PI / 7;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(tip.x - Math.cos(angle - wing) * size, tip.y - Math.sin(angle - wing) * size);
  context.lineTo(tip.x - Math.cos(angle + wing) * size, tip.y - Math.sin(angle + wing) * size);
  context.closePath();
  context.fill();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const angle = normalizeRotation(degrees) * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function normalizePoints(value: unknown): Point[] {
  return Array.isArray(value)
    ? value.map((point: any) => ({ x: Number(point.x || 0), y: Number(point.y || 0) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
}

function parseJson(value: unknown): any {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function normalizeRotation(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? ((number % 360) + 360) % 360 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
