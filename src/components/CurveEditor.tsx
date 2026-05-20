import React, { useRef, useState } from 'react';
import { ColorCurve, Channel, ChannelMask, Keyframe } from '../types';
import { cn } from '../lib/utils';
import { computeTangents, evaluateCurve, InterpMode } from '../lib/curveUtils';

interface CurveEditorProps {
  curve: ColorCurve;
  onChange: (curve: ColorCurve) => void;
  activeChannel: Channel;
  editChannels: ChannelMask;
  onActiveChannelChange: (channel: Channel) => void;
  interpMode: InterpMode;
}

const WIDTH = 1000;
const HEIGHT = 500;
const Y_MAX = 2.0;

const SVG_MARGIN = { top: 20, right: 20, bottom: 20, left: 20 };
const INNER_WIDTH = WIDTH - SVG_MARGIN.left - SVG_MARGIN.right;
const INNER_HEIGHT = HEIGHT - SVG_MARGIN.top - SVG_MARGIN.bottom;

const TIME_TO_X = (time: number) => SVG_MARGIN.left + time * INNER_WIDTH;
const X_TO_TIME = (x: number) => Math.max(0, Math.min(1, (x - SVG_MARGIN.left) / INNER_WIDTH));

const VALUE_TO_Y = (value: number) => SVG_MARGIN.top + INNER_HEIGHT - (value / Y_MAX) * INNER_HEIGHT;
const Y_TO_VALUE = (y: number) => Math.max(0, Math.min(Y_MAX, ((SVG_MARGIN.top + INNER_HEIGHT - y) / INNER_HEIGHT) * Y_MAX));

const CHANNEL_COLORS = {
  r: '#ef4444',
  g: '#22c55e',
  b: '#3b82f6',
  a: '#a8a29e'
};

const POINT_EPSILON = 0.00001;
const CHANNELS: Channel[] = ['r', 'g', 'b', 'a'];
const isBoundaryIndex = (data: Keyframe[], index: number) => index === 0 || index === data.length - 1;
const orderChannelData = (data: Keyframe[]) => {
  if (data.length <= 2) return data;
  const start = data[0];
  const end = data[data.length - 1];
  const interior = data.slice(1, -1).sort((a, b) => a.time - b.time);
  return [start, ...interior, end];
};

export const CurveEditor: React.FC<CurveEditorProps> = ({
  curve,
  onChange,
  activeChannel,
  editChannels,
  onActiveChannelChange,
  interpMode
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ channel: Channel, index: number } | null>(null);
  const [localCurve, setLocalCurve] = useState<ColorCurve>(curve);
  const lastUpdateRef = useRef<number>(0);

  const activeCurveData = draggingPoint ? localCurve : curve;
  const editableChannels = CHANNELS.filter(channel => editChannels[channel]);

  const handlePointerDown = (e: React.PointerEvent<SVGElement>, channel: Channel, pointIndex: number) => {
    if (e.button !== 0) return;
    if (!editChannels[channel]) return;
    e.stopPropagation();
    onActiveChannelChange(channel);
    setLocalCurve(curve);
    setDraggingPoint({ channel, index: pointIndex });
    (e.target as Element).setPointerCapture(e.pointerId);
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

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingPoint || !svgRef.current) return;

    const point = getSvgPoint(e.clientX, e.clientY);
    if (!point) return;

    let newTime = X_TO_TIME(point.x);
    const newValue = Y_TO_VALUE(point.y);

    const channelData = [...localCurve[draggingPoint.channel]];
    const index = draggingPoint.index;
    
    const minTime = index > 0 ? channelData[index - 1].time + POINT_EPSILON : 0;
    const maxTime = index < channelData.length - 1 ? channelData[index + 1].time - POINT_EPSILON : 1;
    
    newTime = Math.max(minTime, Math.min(newTime, maxTime));

    channelData[index] = {
      time: newTime,
      value: newValue
    };

    const newCurve = {
      ...localCurve,
      [draggingPoint.channel]: channelData
    };
    
    setLocalCurve(newCurve);

    // Throttle external onChange to avoid extreme lag from heavy parent components
    const now = performance.now();
    if (now - lastUpdateRef.current > 60) {
      onChange(newCurve);
      lastUpdateRef.current = now;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint) {
      const target = e.target as Element;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      
      const channelData = orderChannelData([...localCurve[draggingPoint.channel]]);
      const newCurve = {
        ...localCurve,
        [draggingPoint.channel]: channelData
      };
      
      setLocalCurve(newCurve);
      onChange(newCurve);
      setDraggingPoint(null);
    }
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const point = getSvgPoint(e.clientX, e.clientY);
    if (!point) return;

    let newTime = X_TO_TIME(point.x);
    const newValue = Y_TO_VALUE(point.y);
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

    const channelData = currentChannelData.length >= 2
      ? orderChannelData([
          currentChannelData[0],
          ...currentChannelData.slice(1, -1),
          { time: newTime, value: newValue },
          currentChannelData[currentChannelData.length - 1]
        ])
      : orderChannelData([...currentChannelData, { time: newTime, value: newValue }]);
    const newCurve = {
      ...activeCurveData,
      [targetChannel]: channelData
    };
    
    setLocalCurve(newCurve);
    onChange(newCurve);
  };

  const handlePointContextMenu = (e: React.MouseEvent, channel: Channel, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    const channelData = [...activeCurveData[channel]];
    if (!editChannels[channel]) return;
    if (channelData.length <= 2 || isBoundaryIndex(channelData, index)) return;
    
    setDraggingPoint(null);
    channelData.splice(index, 1);
    const newCurve = {
      ...activeCurveData,
      [channel]: channelData
    };
    
    setLocalCurve(newCurve);
    onChange(newCurve);
  };

  const drawGrid = () => {
    const lines = [];
    // Y-axis markers (0.0 to Y_MAX)
    for (let i = 0; i <= Y_MAX * 10; i++) {
        const value = i / 10;
        const y = VALUE_TO_Y(value);
        const isMajor = i % 10 === 0;
        const isOne = value === 1.0;
        
        lines.push(
            <line
                key={`h-${i}`}
                x1={SVG_MARGIN.left}
                y1={y}
                x2={WIDTH - SVG_MARGIN.right}
                y2={y}
                stroke={isOne ? '#52525b' : isMajor ? '#3f3f46' : '#27272a'}
                strokeWidth={isOne ? 2 : 1}
            />
        );
        
        if (isMajor || isOne) {
             lines.push(
                <text key={`ht-${i}`} x={SVG_MARGIN.left - 5} y={y + 4} fill="#a1a1aa" fontSize="12" textAnchor="end">
                  {value.toFixed(1)}
                </text>
             );
        }
    }
    
    // X-axis markers (0.0 to 1.0)
    for (let i = 0; i <= 10; i++) {
        const time = i / 10;
        const x = TIME_TO_X(time);
        const isMajor = i === 0 || i === 5 || i === 10;
        
        lines.push(
             <line
                key={`v-${i}`}
                x1={x}
                y1={SVG_MARGIN.top}
                x2={x}
                y2={HEIGHT - SVG_MARGIN.bottom}
                stroke={isMajor ? '#3f3f46' : '#27272a'}
                strokeWidth={1}
            />
        );
        if (isMajor) {
            lines.push(
                <text key={`vt-${i}`} x={x} y={HEIGHT - SVG_MARGIN.bottom + 15} fill="#a1a1aa" fontSize="12" textAnchor="middle">
                  {time.toFixed(1)}
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
      pathD += `M ${TIME_TO_X(sortedData[0].time)},${VALUE_TO_Y(sortedData[0].value)} `;
      
      const tangents = computeTangents(sortedData);
      
      for (let i = 0; i < sortedData.length - 1; i++) {
        const k0 = sortedData[i];
        const k1 = sortedData[i+1];
        
        if (interpMode === 'constant') {
          pathD += `L ${TIME_TO_X(k1.time)},${VALUE_TO_Y(k0.value)} L ${TIME_TO_X(k1.time)},${VALUE_TO_Y(k1.value)} `;
        } else if (interpMode === 'linear') {
          pathD += `L ${TIME_TO_X(k1.time)},${VALUE_TO_Y(k1.value)} `;
        } else {
          const dx = k1.time - k0.time;
          const m0 = tangents[i];
          const m1 = tangents[i+1];
          
          const cp1_t = k0.time + dx / 3;
          const cp1_v = k0.value + m0 * (dx / 3);
          
          const cp2_t = k1.time - dx / 3;
          const cp2_v = k1.value - m1 * (dx / 3);
          
          pathD += `C ${TIME_TO_X(cp1_t)},${VALUE_TO_Y(cp1_v)} ${TIME_TO_X(cp2_t)},${VALUE_TO_Y(cp2_v)} ${TIME_TO_X(k1.time)},${VALUE_TO_Y(k1.value)} `;
        }
      }
    }
    
    const isActive = activeChannel === channel;
    const isDraggingThis = draggingPoint?.channel === channel;
    const isEditable = editChannels[channel];
    const showPoints = isEditable;
    const strokeOpacity = isEditable ? 1 : 0.3;
    const strokeWidth = isActive ? 3 : isEditable ? 2 : 1.25;

    const startBoundary = data[0];
    const endBoundary = data[data.length - 1];
    const extensionOpacity = isActive ? 0.28 : Math.min(strokeOpacity, 0.18);

    return (
      <g key={channel}>
        {startBoundary.time > POINT_EPSILON && (
          <line
            x1={TIME_TO_X(0)}
            y1={VALUE_TO_Y(startBoundary.value)}
            x2={TIME_TO_X(startBoundary.time)}
            y2={VALUE_TO_Y(startBoundary.value)}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={1.5}
            opacity={extensionOpacity}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {endBoundary.time < 1 - POINT_EPSILON && (
          <line
            x1={TIME_TO_X(endBoundary.time)}
            y1={VALUE_TO_Y(endBoundary.value)}
            x2={TIME_TO_X(1)}
            y2={VALUE_TO_Y(endBoundary.value)}
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
            const x = TIME_TO_X(k.time);
            const y = VALUE_TO_Y(k.value);
            const canRemove = data.length > 2 && !isBoundaryIndex(data, i);
            const radius = isActive ? (isDraggingThis && draggingPoint?.index === i ? 8 : 6) : 4;

            return (
                <g
                    key={`${channel}-${i}`}
                    className={cn(
                      "outline-none",
                      editChannels[channel] && (canRemove ? "cursor-pointer" : "cursor-grab")
                    )}
                    onPointerDown={(e) => handlePointerDown(e, channel, i)}
                    onContextMenu={(e) => handlePointContextMenu(e, channel, i)}
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <title>{canRemove ? 'Right-click to remove point' : 'Dependent boundary point'}</title>
                    <circle
                        cx={x}
                        cy={y}
                        r={radius}
                        fill={CHANNEL_COLORS[channel]}
                        stroke="#18181b"
                        strokeWidth={2}
                        className="transition-colors"
                    />
                    {canRemove && (
                      <circle
                          cx={x}
                          cy={y}
                          r={Math.max(2, radius * 0.45)}
                          fill="#000"
                          stroke="none"
                          style={{ pointerEvents: 'none' }}
                      />
                    )}
                    {isActive && (
                      <circle
                          cx={x}
                          cy={y}
                          r={radius + 3}
                          fill="none"
                          stroke="white"
                          strokeWidth={1}
                          opacity={canRemove ? 0 : 0.35}
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
    <div className="w-full aspect-[2/1] relative select-none rounded-xl bg-[#09090b] border border-zinc-800 overflow-hidden shadow-2xl">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleSvgDoubleClick}
      >
        {drawGrid()}
        {CHANNELS.map(ch => drawCurve(ch))}
      </svg>
      <div className="absolute top-4 right-4 text-xs text-zinc-500 font-mono pointer-events-none drop-shadow-md">
        Double-click to add point &bull; Right-click point to remove 
      </div>
    </div>
  );
};
