import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { ColorCurve, Channel, ChannelMask, CurvePoint } from '../types';
import { cn } from '../lib/utils';
import { computeTangents, evaluateCurve, InterpMode } from '../lib/curveUtils';
import {
  DEFAULT_CURVE_VIEWPORT,
  buildTicks,
  clampViewport,
  panViewport,
  screenDeltaToCurveDelta,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  zoomViewport,
  type CurveViewport,
  type PlotRect
} from '../lib/curveViewport';
import {
  applyPointMoveConstraints,
  canDeletePoint,
  canDragPoint,
  createAuthoredInteriorPoint,
  getEdgeOwner,
  getOutgoingInterpolation,
  orderCurvePoints,
  type SelectedPointRef
} from '../lib/curvePointPolicy';

interface CurveEditorProps {
  curve: ColorCurve;
  onChange: (curve: ColorCurve) => void;
  activeChannel: Channel;
  editChannels: ChannelMask;
  selectedPoint: SelectedPointRef | null;
  onActiveChannelChange: (channel: Channel) => void;
  onEditChannelToggle?: (channel: Channel) => void;
  onSelectedPointChange: (selection: SelectedPointRef | null) => void;
  interpMode: InterpMode;
  width?: number;
  height?: number;
  className?: string;
}

const WIDTH = 1000;
const HEIGHT = 500;
const PREVIEW_STRIP_HEIGHT = 24;
const CONTROL_BAR_HEIGHT = 36;

const SVG_MARGIN = { top: 20, right: 20, bottom: 20, left: 20 };
const INNER_WIDTH = WIDTH - SVG_MARGIN.left - SVG_MARGIN.right;
const INNER_HEIGHT = HEIGHT - SVG_MARGIN.top - SVG_MARGIN.bottom;
const PLOT_RECT: PlotRect = {
  left: SVG_MARGIN.left,
  top: SVG_MARGIN.top,
  right: WIDTH - SVG_MARGIN.right,
  bottom: HEIGHT - SVG_MARGIN.bottom,
  width: INNER_WIDTH,
  height: INNER_HEIGHT
};

const CHANNEL_COLORS = {
  r: '#ef4444',
  g: '#22c55e',
  b: '#3b82f6',
  a: '#a8a29e'
};

const POINT_EPSILON = 0.00001;
const DRAG_THRESHOLD_PX = 3;
const POINT_HIT_RADIUS = 12;
const CHANNELS: Channel[] = ['r', 'g', 'b', 'a'];
const isEdgeOwner = (point: CurvePoint) => getEdgeOwner(point) === 'start' || getEdgeOwner(point) === 'end';
const WHEEL_ZOOM_INTENSITY = 0.0015;
type DragGesture = {
  channel: Channel;
  pointId: string;
  startClientX: number;
  startClientY: number;
  hasMoved: boolean;
};

type PanGesture = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  hasMoved: boolean;
};

export const CurveEditor: React.FC<CurveEditorProps> = ({
  curve,
  onChange,
  activeChannel,
  editChannels,
  selectedPoint,
  onActiveChannelChange,
  onEditChannelToggle,
  onSelectedPointChange,
  interpMode,
  width,
  height,
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ channel: Channel, pointId: string } | null>(null);
  const [localCurve, setLocalCurve] = useState<ColorCurve>(curve);
  const [viewport, setViewport] = useState<CurveViewport>(DEFAULT_CURVE_VIEWPORT);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [cursorValue, setCursorValue] = useState<{ time: number; value: number } | null>(null);
  const liveCurveRef = useRef<ColorCurve>(curve);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const viewportRef = useRef<CurveViewport>(DEFAULT_CURVE_VIEWPORT);
  const viewportFrameRef = useRef<number | null>(null);
  const queuedViewportRef = useRef<CurveViewport | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);

  const activeCurveData = draggingPoint ? localCurve : curve;
  const editableChannels = CHANNELS.filter(channel => editChannels[channel]);
  const boundedWidth = width && width > 0 ? width : undefined;
  const boundedHeight = height && height > 0 ? height : undefined;

  const horizontalStripGradient = useMemo(() => {
    const sortedCurve = {
      r: [...curve.r].sort((a, b) => a.time - b.time),
      g: [...curve.g].sort((a, b) => a.time - b.time),
      b: [...curve.b].sort((a, b) => a.time - b.time),
    };

    const tangents = {
      r: computeTangents(sortedCurve.r),
      g: computeTangents(sortedCurve.g),
      b: computeTangents(sortedCurve.b),
    };

    const stops: string[] = [];
    const steps = 20;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.r, tangents.r, t, interpMode))) * 255
      );
      const g = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.g, tangents.g, t, interpMode))) * 255
      );
      const b = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.b, tangents.b, t, interpMode))) * 255
      );

      stops.push(`rgb(${r},${g},${b}) ${t * 100}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [curve, interpMode]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (event: WheelEvent) => {
      if (!container.contains(event.target as Node)) return;
      event.preventDefault();

      const point = getSvgPoint(event.clientX, event.clientY);
      if (!point || event.deltaY === 0) return;

      const anchor = {
        time: xToTime(point.x, viewportRef.current, PLOT_RECT),
        value: viewportRef.current.valueMin + ((PLOT_RECT.bottom - point.y) / PLOT_RECT.height) * (viewportRef.current.valueMax - viewportRef.current.valueMin)
      };
      const scale = Math.exp(event.deltaY * WHEEL_ZOOM_INTENSITY);
      const zoomX = event.altKey ? 1 : scale;
      const zoomY = event.shiftKey ? 1 : scale;
      applyZoom(zoomX, zoomY, anchor);
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  });

  const scheduleViewport = (nextViewport: CurveViewport) => {
    const clamped = clampViewport(nextViewport);
    queuedViewportRef.current = clamped;
    viewportRef.current = clamped;

    if (viewportFrameRef.current !== null) return;
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      const queued = queuedViewportRef.current;
      if (!queued) return;
      queuedViewportRef.current = null;
      setViewport(queued);
    });
  };

  const curveToScreen = (time: number, value: number, sourceViewport = viewportRef.current) => ({
    x: timeToX(time, sourceViewport, PLOT_RECT),
    y: valueToY(value, sourceViewport, PLOT_RECT)
  });

  const screenToCurve = (point: { x: number; y: number }, sourceViewport = viewportRef.current) => ({
    time: xToTime(point.x, sourceViewport, PLOT_RECT),
    value: yToValue(point.y, sourceViewport, PLOT_RECT)
  });

  const applyZoom = (scaleX: number, scaleY: number, anchor?: { time: number; value: number }) => {
    const currentViewport = viewportRef.current;
    const zoomAnchor = anchor ?? {
      time: (currentViewport.timeMin + currentViewport.timeMax) / 2,
      value: (currentViewport.valueMin + currentViewport.valueMax) / 2
    };
    scheduleViewport(zoomViewport(currentViewport, zoomAnchor, scaleX, scaleY));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGElement>, channel: Channel, pointIndex: number) => {
    if (e.button !== 0) return;
    if (!editChannels[channel]) return;
    const point = curve[channel][pointIndex];
    e.stopPropagation();
    onActiveChannelChange(channel);
    onSelectedPointChange({ channel, pointId: point.id });
    if (!canDragPoint(point)) return;
    setLocalCurve(curve);
    liveCurveRef.current = curve;
    dragGestureRef.current = {
      channel,
      pointId: point.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      hasMoved: false
    };
    setDraggingPoint({ channel, pointId: point.id });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint) return;
    const shouldPan = e.button === 1 || (e.button === 0 && isSpacePressed);
    if (!shouldPan) return;

    e.preventDefault();
    panGestureRef.current = {
      pointerId: e.pointerId,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      hasMoved: false
    };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const getSvgPoint = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;

    return {
      x: (clientX - ctm.e) / ctm.a,
      y: (clientY - ctm.f) / ctm.d
    };
  };

  const detectEditableChannel = (time: number, value: number) => {
    if (editableChannels.length === 0) return null;
    if (editableChannels.length === 1) return editableChannels[0];

    return editableChannels.reduce((nearest, channel) => {
      const sortedData = [...activeCurveData[channel]].sort((a, b) => a.time - b.time);
      const tangents = computeTangents(sortedData);
      const channelValue = evaluateCurve(sortedData, tangents, time, interpMode);
      const distance = Math.abs(channelValue - value);

      return !nearest || distance < nearest.distance
        ? { channel, distance }
        : nearest;
    }, null as { channel: Channel; distance: number } | null)?.channel ?? editableChannels[0];
  };

  const findNearestEditablePoint = (svgPoint: { x: number; y: number }, maxDistance = POINT_HIT_RADIUS) => {
    return editableChannels.reduce((nearest, channel) => {
      return activeCurveData[channel].reduce((channelNearest, point) => {
        const screenPoint = curveToScreen(point.time, point.value);
        const dx = screenPoint.x - svgPoint.x;
        const dy = screenPoint.y - svgPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDistance) return channelNearest;
        if (!channelNearest || distance < channelNearest.distance) {
          return { channel, point, distance };
        }
        return channelNearest;
      }, nearest);
    }, null as { channel: Channel; point: CurvePoint; distance: number } | null);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svgPoint = getSvgPoint(e.clientX, e.clientY);
    if (svgPoint) {
      setCursorValue(screenToCurve(svgPoint));
    }

    const panGesture = panGestureRef.current;
    if (panGesture && panGesture.pointerId === e.pointerId) {
      e.preventDefault();
      const dx = e.clientX - panGesture.lastClientX;
      const dy = e.clientY - panGesture.lastClientY;
      const delta = screenDeltaToCurveDelta(dx, dy, viewportRef.current, PLOT_RECT);
      panGestureRef.current = {
        ...panGesture,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        hasMoved: panGesture.hasMoved || Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX
      };
      scheduleViewport(panViewport(viewportRef.current, delta.time, delta.value));
      return;
    }

    if (!draggingPoint || !svgRef.current) return;

    const dragGesture = dragGestureRef.current;
    if (!dragGesture) return;

    if (!dragGesture.hasMoved) {
      const dx = e.clientX - dragGesture.startClientX;
      const dy = e.clientY - dragGesture.startClientY;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
      dragGestureRef.current = {
        ...dragGesture,
        hasMoved: true
      };
    }

    const point = svgPoint ?? getSvgPoint(e.clientX, e.clientY);
    if (!point) return;

    const nextCurvePoint = screenToCurve(point);
    const newTime = nextCurvePoint.time;
    const newValue = nextCurvePoint.value;

    const currentCurve = liveCurveRef.current;
    const channelData = [...currentCurve[draggingPoint.channel]];
    const index = channelData.findIndex(point => point.id === draggingPoint.pointId);
    if (index === -1) return;
    const currentPoint = channelData[index];
    if (!canDragPoint(currentPoint)) return;

    const constrainedMove = applyPointMoveConstraints(channelData, index, { time: newTime, value: newValue }, POINT_EPSILON);

    channelData[index] = {
      ...currentPoint,
      time: constrainedMove.time,
      value: constrainedMove.value
    };

    const newCurve = {
      ...currentCurve,
      [draggingPoint.channel]: channelData
    };
    
    liveCurveRef.current = newCurve;
    setLocalCurve(newCurve);
    onChange(newCurve);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panGestureRef.current?.pointerId === e.pointerId) {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      panGestureRef.current = null;
      setIsPanning(false);
    }

    if (draggingPoint) {
      const target = e.target as Element;
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }

      if (dragGestureRef.current?.hasMoved) {
        const currentCurve = liveCurveRef.current;
        const channelData = orderCurvePoints([...currentCurve[draggingPoint.channel]]);
        const newCurve = {
          ...currentCurve,
          [draggingPoint.channel]: channelData
        };
        
        liveCurveRef.current = newCurve;
        setLocalCurve(newCurve);
        onChange(newCurve);
      }

      dragGestureRef.current = null;
      setDraggingPoint(null);
    }
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (panGestureRef.current?.hasMoved) return;
    const point = getSvgPoint(e.clientX, e.clientY);
    if (!point) return;

    const nearestPoint = findNearestEditablePoint(point);
    if (nearestPoint) {
      e.preventDefault();
      onActiveChannelChange(nearestPoint.channel);
      onSelectedPointChange({ channel: nearestPoint.channel, pointId: nearestPoint.point.id });
      return;
    }

    const nextCurvePoint = screenToCurve(point);
    let newTime = nextCurvePoint.time;
    const newValue = nextCurvePoint.value;
    const targetChannel = detectEditableChannel(newTime, newValue);
    if (!targetChannel) return;

    onActiveChannelChange(targetChannel);
    const currentChannelData = activeCurveData[targetChannel];

    if (currentChannelData.length >= 2) {
      const minTime = currentChannelData[0].time + POINT_EPSILON;
      const maxTime = currentChannelData[currentChannelData.length - 1].time - POINT_EPSILON;
      if (minTime > maxTime) return;
      newTime = Math.max(minTime, Math.min(newTime, maxTime));
    }

    const newPoint = createAuthoredInteriorPoint(newTime, newValue);
    const channelData = currentChannelData.length >= 2
      ? orderCurvePoints([
          currentChannelData[0],
          ...currentChannelData.slice(1, -1),
          newPoint,
          currentChannelData[currentChannelData.length - 1]
        ])
      : orderCurvePoints([...currentChannelData, newPoint]);
    const newCurve = {
      ...activeCurveData,
      [targetChannel]: channelData
    };
    
    setLocalCurve(newCurve);
    onSelectedPointChange({ channel: targetChannel, pointId: newPoint.id });
    onChange(newCurve);
  };

  const handlePointContextMenu = (e: React.MouseEvent, channel: Channel, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    const channelData = [...activeCurveData[channel]];
    if (!editChannels[channel]) return;
    const point = channelData[index];
    if (channelData.length <= 2 || !canDeletePoint(point)) return;
    
    setDraggingPoint(null);
    channelData.splice(index, 1);
    const newCurve = {
      ...activeCurveData,
      [channel]: channelData
    };
    
    setLocalCurve(newCurve);
    if (selectedPoint?.channel === channel && selectedPoint.pointId === point.id) {
      onSelectedPointChange(null);
    }
    onChange(newCurve);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    setIsSpacePressed(true);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    setIsSpacePressed(false);
  };

  const drawGrid = () => {
    const lines = [];

    for (const tick of buildTicks(viewport.valueMin, viewport.valueMax, 4)) {
      const y = valueToY(tick.value, viewport, PLOT_RECT);
      const isOne = Math.abs(tick.value - 1) < POINT_EPSILON;

      lines.push(
        <line
          key={`h-${tick.value}`}
          x1={PLOT_RECT.left}
          y1={y}
          x2={PLOT_RECT.right}
          y2={y}
          stroke={isOne ? '#52525b' : tick.major ? '#3f3f46' : '#27272a'}
          strokeWidth={isOne ? 2 : 1}
        />
      );

      if (tick.major || isOne) {
        lines.push(
          <text key={`ht-${tick.value}`} x={PLOT_RECT.left - 5} y={y + 4} fill="#a1a1aa" fontSize="12" textAnchor="end">
            {isOne ? '1.0' : tick.label}
          </text>
        );
      }
    }

    for (const tick of buildTicks(viewport.timeMin, viewport.timeMax, 5)) {
      const x = timeToX(tick.value, viewport, PLOT_RECT);

      lines.push(
        <line
          key={`v-${tick.value}`}
          x1={x}
          y1={PLOT_RECT.top}
          x2={x}
          y2={PLOT_RECT.bottom}
          stroke={tick.major ? '#3f3f46' : '#27272a'}
          strokeWidth={1}
        />
      );
      if (tick.major) {
        lines.push(
          <text key={`vt-${tick.value}`} x={x} y={PLOT_RECT.bottom + 15} fill="#a1a1aa" fontSize="12" textAnchor="middle">
            {tick.label}
          </text>
        );
      }
    }
    return lines;
  };

  const drawCurve = (channel: Channel) => {
    const data = activeCurveData[channel];
    if (data.length === 0) return null;

    // We sort just for drawing, to ensure correct lines even while dragging
    const sortedData = [...data].sort((a,b) => a.time - b.time);
    
    let pathD = '';
    if (sortedData.length > 0) {
      pathD += `M ${timeToX(sortedData[0].time, viewport, PLOT_RECT)},${valueToY(sortedData[0].value, viewport, PLOT_RECT)} `;
      
      const tangents = computeTangents(sortedData);
      
      for (let i = 0; i < sortedData.length - 1; i++) {
        const k0 = sortedData[i];
        const k1 = sortedData[i+1];
        
        const segmentInterpolation = getOutgoingInterpolation(k0);
        if (segmentInterpolation === 'constant') {
          pathD += `L ${timeToX(k1.time, viewport, PLOT_RECT)},${valueToY(k0.value, viewport, PLOT_RECT)} L ${timeToX(k1.time, viewport, PLOT_RECT)},${valueToY(k1.value, viewport, PLOT_RECT)} `;
        } else if (segmentInterpolation === 'linear') {
          pathD += `L ${timeToX(k1.time, viewport, PLOT_RECT)},${valueToY(k1.value, viewport, PLOT_RECT)} `;
        } else {
          const dx = k1.time - k0.time;
          const m0 = tangents[i];
          const m1 = tangents[i+1];
          
          const cp1_t = k0.time + dx / 3;
          const cp1_v = k0.value + m0 * (dx / 3);
          
          const cp2_t = k1.time - dx / 3;
          const cp2_v = k1.value - m1 * (dx / 3);
          
          pathD += `C ${timeToX(cp1_t, viewport, PLOT_RECT)},${valueToY(cp1_v, viewport, PLOT_RECT)} ${timeToX(cp2_t, viewport, PLOT_RECT)},${valueToY(cp2_v, viewport, PLOT_RECT)} ${timeToX(k1.time, viewport, PLOT_RECT)},${valueToY(k1.value, viewport, PLOT_RECT)} `;
        }
      }
    }
    
    const isActive = activeChannel === channel;
    const isDraggingThis = draggingPoint?.channel === channel;
    const isEditable = editChannels[channel];
    const showPoints = isEditable;
    const strokeOpacity = isEditable ? 1 : 0.3;
    const strokeWidth = isActive ? 3 : isEditable ? 2 : 1.25;

    const startBoundary = data.find(point => getEdgeOwner(point) === 'start') ?? data[0];
    const endBoundary = data.find(point => getEdgeOwner(point) === 'end') ?? data[data.length - 1];
    const extensionOpacity = isActive ? 0.28 : Math.min(strokeOpacity, 0.18);

    return (
      <g key={channel}>
        {startBoundary.time > POINT_EPSILON && (
          <line
            x1={timeToX(0, viewport, PLOT_RECT)}
            y1={valueToY(startBoundary.value, viewport, PLOT_RECT)}
            x2={timeToX(startBoundary.time, viewport, PLOT_RECT)}
            y2={valueToY(startBoundary.value, viewport, PLOT_RECT)}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={1.5}
            opacity={extensionOpacity}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {endBoundary.time < 1 - POINT_EPSILON && (
          <line
            x1={timeToX(endBoundary.time, viewport, PLOT_RECT)}
            y1={valueToY(endBoundary.value, viewport, PLOT_RECT)}
            x2={timeToX(1, viewport, PLOT_RECT)}
            y2={valueToY(endBoundary.value, viewport, PLOT_RECT)}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={1.5}
            opacity={extensionOpacity}
            style={{ pointerEvents: 'none' }}
          />
        )}
        <path
            d={pathD}
            fill="none"
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={strokeWidth}
            opacity={strokeOpacity}
            style={{ pointerEvents: 'none' }}
        />
        {showPoints && data.map((k, i) => {
            const { x, y } = curveToScreen(k.time, k.value, viewport);
            const canRemove = data.length > 2 && canDeletePoint(k);
            const isSelected = selectedPoint?.channel === channel && selectedPoint.pointId === k.id;
            const isDraggingPoint = isDraggingThis && draggingPoint?.pointId === k.id;
            const radius = isActive ? (isDraggingPoint ? 8 : 6) : 4;
            const canMove = canDragPoint(k);
            const isProtected = k.flags.includes('protected');
            const isPreserved = k.flags.includes('uncompressible');
            const markerOpacity = k.role === 'sample' ? 0.62 : 1;
            const markerStroke = isProtected ? '#f8fafc' : isSelected ? '#ffffff' : '#18181b';
            const markerStrokeWidth = isProtected || isSelected ? 2.5 : 2;
            const title = canRemove ? 'Right-click to remove point' : isEdgeOwner(k) ? 'Boundary edge owner' : 'Protected point';

            return (
                <g
                    key={`${channel}-${k.id}`}
                    className={cn(
                      "outline-none",
                      editChannels[channel] && (canMove ? (canRemove ? "cursor-pointer" : "cursor-grab") : "cursor-not-allowed")
                    )}
                    onPointerDown={(e) => handlePointerDown(e, channel, i)}
                    onContextMenu={(e) => handlePointContextMenu(e, channel, i)}
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <title>{title}</title>
                    {isSelected && (
                      <circle
                          cx={x}
                          cy={y}
                          r={radius + 5}
                          fill="none"
                          stroke="white"
                          strokeWidth={1.25}
                          opacity={0.72}
                          style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {k.role === 'feature' ? (
                      <rect
                          x={x - radius}
                          y={y - radius}
                          width={radius * 2}
                          height={radius * 2}
                          transform={`rotate(45 ${x} ${y})`}
                          fill={CHANNEL_COLORS[channel]}
                          opacity={markerOpacity}
                          stroke={markerStroke}
                          strokeWidth={markerStrokeWidth}
                          className="transition-colors"
                      />
                    ) : (
                      <circle
                        cx={x}
                        cy={y}
                        r={k.role === 'sample' ? Math.max(3, radius - 1.5) : radius}
                        fill={k.role === 'boundary' ? '#09090b' : CHANNEL_COLORS[channel]}
                        opacity={markerOpacity}
                        stroke={k.role === 'boundary' ? CHANNEL_COLORS[channel] : markerStroke}
                        strokeWidth={k.role === 'boundary' ? markerStrokeWidth + 0.5 : markerStrokeWidth}
                        className="transition-colors"
                      />
                    )}
                    {k.role === 'anchor' && (
                      <circle
                          cx={x}
                          cy={y}
                          r={Math.max(1.5, radius * 0.34)}
                          fill="#000"
                          stroke="none"
                          style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {(canRemove || isPreserved) && k.role !== 'feature' && (
                      <circle
                          cx={x}
                          cy={y}
                          r={Math.max(2, radius * 0.45)}
                          fill={isPreserved ? '#f8fafc' : '#000'}
                          stroke="none"
                          style={{ pointerEvents: 'none' }}
                      />
                    )}
                </g>
            );
        })}
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: boundedWidth,
        height: boundedHeight,
      }}
      className={cn(
        "w-full min-h-[240px] relative select-none rounded-xl bg-[#09090b] border border-zinc-800 overflow-hidden shadow-2xl outline-none p-2 flex flex-col gap-2",
        className ?? "h-full"
      )}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={() => {
        setIsSpacePressed(false);
        setIsPanning(false);
        panGestureRef.current = null;
      }}
    >
      <div
        style={{ height: PREVIEW_STRIP_HEIGHT }}
        className="relative w-full shrink-0 overflow-hidden rounded border border-zinc-800/80 opacity-90 shadow-inner"
      >
        <div className="absolute inset-0" style={{ background: horizontalStripGradient }} />
        <div className="pointer-events-none absolute bottom-0 left-2 top-0 flex items-center">
          <span className="rounded bg-white/20 px-1 font-mono text-[9px] font-bold tracking-widest text-black mix-blend-difference">
            1D COLOR PREVIEW
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-zinc-900/80 bg-[#09090b]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={cn("absolute inset-0 h-full w-full touch-none", isPanning ? "cursor-grabbing" : isSpacePressed ? "cursor-grab" : "cursor-crosshair")}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleSvgDoubleClick}
        >
          {drawGrid()}
          {CHANNELS.map(ch => drawCurve(ch))}
        </svg>
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-zinc-800 bg-black/80 p-1 shadow-xl backdrop-blur">
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => applyZoom(1.25, 1.25)}
            className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Fit view"
            aria-label="Fit view"
            onClick={() => scheduleViewport(DEFAULT_CURVE_VIEWPORT)}
            className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => applyZoom(0.8, 0.8)}
            className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-zinc-500 drop-shadow-md">
          Wheel zoom &bull; Shift/Alt axis zoom &bull; Space or middle drag pan
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] text-zinc-500 drop-shadow-md">
          {cursorValue
            ? `T ${cursorValue.time.toFixed(3)}  V ${cursorValue.value.toFixed(3)}`
            : 'Double-click add point'}
        </div>
      </div>

      <div
        style={{ height: CONTROL_BAR_HEIGHT }}
        className="flex w-full shrink-0 items-center justify-between gap-3 border-t border-zinc-900/80 pt-1"
      >
        <div className="flex items-center gap-1 rounded border border-zinc-950 bg-zinc-900/40 p-0.5">
          {CHANNELS.map((channel) => {
            const isActive = activeChannel === channel;
            const isEditable = editChannels[channel];

            return (
              <button
                key={channel}
                type="button"
                onClick={() => {
                  onActiveChannelChange(channel);
                  onEditChannelToggle?.(channel);
                }}
                aria-label={`Toggle ${channel.toUpperCase()} editing`}
                aria-pressed={isEditable}
                className={cn(
                  "flex h-6 min-w-8 items-center justify-center gap-1 rounded border px-1.5 font-mono text-[10px] font-bold transition-colors",
                  isActive
                    ? "border-white bg-white text-black"
                    : "border-transparent bg-transparent text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
                  !isEditable && "opacity-45"
                )}
                title={`${isEditable ? 'Disable' : 'Enable'} ${channel.toUpperCase()} editing`}
              >
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ backgroundColor: CHANNEL_COLORS[channel] }}
                />
                {channel.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div className="truncate text-right font-mono text-[10px] tracking-wider text-zinc-500">
          DOMAIN: <span className="font-bold text-zinc-400">[ 0.000 ] - [ 1.000 ]</span>
        </div>
      </div>
    </div>
  );
};
