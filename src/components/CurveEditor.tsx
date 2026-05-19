import React, { useRef, useState, useMemo, useEffect } from 'react';
import { ColorCurve, Channel, Keyframe } from '../types';
import { cn } from '../lib/utils';
import { computeTangents, InterpMode } from '../lib/curveUtils';

interface CurveEditorProps {
  curve: ColorCurve;
  onChange: (curve: ColorCurve) => void;
  activeChannel: Channel;
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

export const CurveEditor: React.FC<CurveEditorProps> = ({ curve, onChange, activeChannel, interpMode }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ channel: Channel, index: number } | null>(null);
  const [localCurve, setLocalCurve] = useState<ColorCurve>(curve);
  const lastUpdateRef = useRef<number>(0);

  const activeCurveData = draggingPoint ? localCurve : curve;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>, channel: Channel, pointIndex: number) => {
    e.stopPropagation();
    setLocalCurve(curve);
    setDraggingPoint({ channel, index: pointIndex });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingPoint || !svgRef.current) return;

    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;

    const x = (e.clientX - ctm.e) / ctm.a;
    const y = (e.clientY - ctm.f) / ctm.d;

    let newTime = X_TO_TIME(x);
    const newValue = Y_TO_VALUE(y);

    const channelData = [...localCurve[draggingPoint.channel]];
    const index = draggingPoint.index;
    
    const minTime = index > 0 ? channelData[index - 1].time + 0.00001 : 0;
    const maxTime = index < channelData.length - 1 ? channelData[index + 1].time - 0.00001 : 1;
    
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
      
      const channelData = [...localCurve[draggingPoint.channel]].sort((a, b) => a.time - b.time);
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
    if (!svgRef.current) return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;

    const x = (e.clientX - ctm.e) / ctm.a;
    const y = (e.clientY - ctm.f) / ctm.d;

    const newTime = X_TO_TIME(x);
    const newValue = Y_TO_VALUE(y);

    const channelData = [...activeCurveData[activeChannel], { time: newTime, value: newValue }].sort((a, b) => a.time - b.time);
    const newCurve = {
      ...activeCurveData,
      [activeChannel]: channelData
    };
    
    setLocalCurve(newCurve);
    onChange(newCurve);
  };

  const handlePointContextMenu = (e: React.MouseEvent, channel: Channel, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    const channelData = [...activeCurveData[channel]];
    if (channelData.length <= 1) return;
    
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

    return (
      <g key={channel}>
        <path
            d={pathD}
            fill="none"
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={isActive ? 3 : 1.5}
            opacity={isActive ? 1.0 : 0.4}
            style={{ pointerEvents: 'none' }}
        />
        {data.map((k, i) => {
            const x = TIME_TO_X(k.time);
            const y = VALUE_TO_Y(k.value);
            return (
                <circle
                    key={`${channel}-${i}`}
                    cx={x}
                    cy={y}
                    r={isActive ? (draggingPoint?.index === i ? 8 : 6) : 4}
                    fill={CHANNEL_COLORS[channel]}
                    stroke="#18181b"
                    strokeWidth={2}
                    className="cursor-pointer hover:stroke-white transition-colors outline-none"
                    onPointerDown={(e) => handlePointerDown(e, channel, i)}
                    onContextMenu={(e) => handlePointContextMenu(e, channel, i)}
                />
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
        {['r', 'g', 'b', 'a'].map(ch => drawCurve(ch as Channel))}
      </svg>
      <div className="absolute top-4 right-4 text-xs text-zinc-500 font-mono pointer-events-none drop-shadow-md">
        Double-click to add point &bull; Right-click point to remove 
      </div>
    </div>
  );
};
