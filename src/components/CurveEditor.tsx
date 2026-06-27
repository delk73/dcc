//! # CurveEditor Module Layout Authority
//! - [Rule 3.1] The 1D color preview strip and the interactive SVG viewport grid must reside within a top-pinned, vertically locked layout stack.
//! - [Rule 3.2] The interactive SVG drawing area must be constrained to a deterministic aspect ratio or maximum pixel height calculation based on `PLOT_RECT` to eliminate aspect-driven vertical line stretching. Trailing dead space must pool as a neutral background gutter at the bottom of the canvas wrapper container.
//! - [Rule 3.3] Controls below the horizontal coordinate axis line must use a full-width layout split: active channel selection selectors anchor left under the 0.00 grid origin column; point metadata properties and numeric inspectors float right under the 1.00 grid end column.
//! - [Rule 3.4] In portrait or vertically surplus layouts, the curve filter, domain bounds, and selected point inspectors must remain snug to the bottom edge of the curve display; any unused vertical space belongs below those controls.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { ColorCurve, Channel, ChannelMask, CurvePoint } from '../types';
import { cn } from '../lib/utils';
import { computeTangents, evaluateCurve, InterpMode } from '../lib/curveUtils';
import {
  DEFAULT_CURVE_VIEWPORT,
  buildTicks,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  type CurveViewport,
  type PlotRect
} from '../lib/curveViewport';
import {
  applyPointMoveConstraints,
  canDeletePoint,
  canDragPoint,
  createAuthoredInteriorPoint,
  getEdgeOwner,
  orderCurvePoints,
  type SelectedPointRef
} from '../lib/curvePointPolicy';

interface CurveEditorProps {
  curve: ColorCurve;
  onChange: (curve: ColorCurve) => void;
  editChannels: ChannelMask;
  activeChannel: Channel;
  selectedPoint: SelectedPointRef | null;
  onActiveChannelChange: (channel: Channel) => void;
  onSelectedPointChange: (selection: SelectedPointRef | null) => void;
  interpMode: InterpMode;
  spaceLever: number;
  domainTime?: number;
  onDomainTimeChange?: (time: number, options?: { commit?: boolean }) => void;
  curveIndexLabel?: string;
  curveIndexTitle?: string;
  width?: number;
  height?: number;
  className?: string;
}

const WIDTH = 1000;
const HEIGHT = 500;
const PREVIEW_STRIP_HEIGHT = 24;
const CONTROL_BAR_HEIGHT = 36;

const PLOT_TOOLBAR_CLEARANCE = 64;
const SVG_MARGIN = { top: PLOT_TOOLBAR_CLEARANCE, right: 20, bottom: 20, left: 20 };
const INNER_WIDTH = WIDTH - SVG_MARGIN.left - SVG_MARGIN.right;
const INNER_HEIGHT = HEIGHT - SVG_MARGIN.top - SVG_MARGIN.bottom;
const PREVIEW_INSET = {
  left: `${(SVG_MARGIN.left / WIDTH) * 100}%`,
  right: `${(SVG_MARGIN.right / WIDTH) * 100}%`,
};
const PLOT_RECT: PlotRect = {
  left: SVG_MARGIN.left,
  top: SVG_MARGIN.top,
  right: WIDTH - SVG_MARGIN.right,
  bottom: HEIGHT - SVG_MARGIN.bottom,
  width: INNER_WIDTH,
  height: INNER_HEIGHT
};
const SVG_ASPECT_RATIO = WIDTH / HEIGHT;

const CHANNEL_COLORS = {
  r: '#ef4444',
  g: '#22c55e',
  b: '#3b82f6',
  a: '#a8a29e'
};

const POINT_EPSILON = 0.00001;
const DRAG_THRESHOLD_PX = 3;
const POINT_HIT_RADIUS = 12;
const PLOT_CLIP_BLEED = POINT_HIT_RADIUS + 4;
const DOMAIN_GUIDE_HIT_RADIUS = 12;
const CHANNELS: Channel[] = ['r', 'g', 'b', 'a'];
const isEdgeOwner = (point: CurvePoint) => getEdgeOwner(point) === 'start' || getEdgeOwner(point) === 'end';
const WHEEL_ZOOM_INTENSITY = 0.0015;
const MIN_ZOOM_X = 1;
const MAX_ZOOM_X = 32;
const ZOOM_BUTTON_FACTOR = 1.25;
const MIN_TRANSFORM_SPAN = 0.001;
const DISPLAY_SAMPLE_PIXEL_STEP = 3;
const DISPLAY_SAMPLE_TIME_PRECISION = 9;
type DragGesture = {
  channel: Channel;
  pointId: string;
  startClientX: number;
  startClientY: number;
  hasMoved: boolean;
  startCurvePoint: { time: number; value: number };
  multiDrag: boolean;
  startCurve: ColorCurve;
};
type BoxSelection = {
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  hasMoved: boolean;
};
type DomainGuideDrag = {
  pointerId: number;
};

const buildDisplayCurvePath = (
  data: CurvePoint[],
  viewport: CurveViewport,
  interpMode: InterpMode
) => {
  if (data.length === 0) return '';

  const sortedData = [...data].sort((a,b) => a.time - b.time);
  const tangents = computeTangents(sortedData);
  const startTime = sortedData[0].time;
  const endTime = sortedData[sortedData.length - 1].time;
  const visibleStartTime = Math.max(startTime, viewport.timeMin);
  const visibleEndTime = Math.min(endTime, viewport.timeMax);
  const visibleSpan = visibleEndTime - visibleStartTime;
  let pathD = '';

  if (visibleSpan < 0) return pathD;

  const sampleTimes = new Map<string, number>();
  const addSampleTime = (time: number) => {
    const clampedTime = Math.max(visibleStartTime, Math.min(visibleEndTime, time));
    sampleTimes.set(clampedTime.toFixed(DISPLAY_SAMPLE_TIME_PRECISION), clampedTime);
  };
  const sampleCount = Math.max(2, Math.ceil(PLOT_RECT.width / DISPLAY_SAMPLE_PIXEL_STEP));

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
    addSampleTime(visibleStartTime + visibleSpan * (sampleIndex / sampleCount));
  }
  sortedData.forEach(point => {
    if (point.time >= visibleStartTime - POINT_EPSILON && point.time <= visibleEndTime + POINT_EPSILON) {
      addSampleTime(point.time);
    }
  });

  [...sampleTimes.values()].sort((a, b) => a - b).forEach((time, sampleIndex) => {
    const value = Math.max(
      viewport.valueMin,
      Math.min(viewport.valueMax, evaluateCurve(sortedData, tangents, time, interpMode))
    );
    const x = timeToX(time, viewport, PLOT_RECT);
    const y = valueToY(value, viewport, PLOT_RECT);
    pathD += `${sampleIndex === 0 ? 'M' : 'L'} ${x},${y} `;
  });

  return pathD;
};

export const CurveEditor: React.FC<CurveEditorProps> = ({
  curve,
  onChange,
  editChannels,
  activeChannel,
  selectedPoint,
  onActiveChannelChange,
  onSelectedPointChange,
  interpMode,
  spaceLever,
  domainTime,
  onDomainTimeChange,
  curveIndexLabel,
  curveIndexTitle,
  width,
  height,
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ channel: Channel, pointId: string } | null>(null);
  const [localCurve, setLocalCurve] = useState<ColorCurve>(curve);
  const [zoomX, setZoomX] = useState(MIN_ZOOM_X);
  const [zoomAnchor, setZoomAnchor] = useState({ time: spaceLever, ratio: 0.5 });
  const [cursorValue, setCursorValue] = useState<{ time: number; value: number } | null>(null);
  const [multiSelectedPoints, setMultiSelectedPoints] = useState<SelectedPointRef[]>([]);
  const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
  const [domainGuideDrag, setDomainGuideDrag] = useState<DomainGuideDrag | null>(null);
  const [liveDomainTime, setLiveDomainTime] = useState<number | null>(null);
  const liveCurveRef = useRef<ColorCurve>(curve);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const latestCursorAnchorRef = useRef({ time: spaceLever, ratio: 0.5 });
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorValueRef = useRef<{ time: number; value: number } | null>(null);
  const curveFrameRef = useRef<number | null>(null);
  const pendingCurveRef = useRef<ColorCurve | null>(null);
  const plotClipId = `curve-plot-${useId().replace(/:/g, '')}`;

  const activeCurveData = draggingPoint ? localCurve : curve;
  const displayDomainTime = liveDomainTime ?? domainTime;
  const editableChannels = CHANNELS.filter(channel => editChannels[channel]);
  const isMultiSelected = (selection: SelectedPointRef) =>
    multiSelectedPoints.some(point => point.channel === selection.channel && point.pointId === selection.pointId);
  const boundedWidth = width && width > 0 ? width : undefined;
  const boundedHeight = height && height > 0 ? height : undefined;
  const availablePlotHeight = Math.max(
    180,
    (boundedHeight ?? HEIGHT) - PREVIEW_STRIP_HEIGHT - CONTROL_BAR_HEIGHT - 48
  );
  const lockedPlotWidth = boundedWidth ?? Math.ceil(availablePlotHeight * SVG_ASPECT_RATIO);

  const computedViewport = useMemo<CurveViewport>(() => {
    const anchorTime = Math.max(0, Math.min(1, zoomAnchor.time));
    const anchorRatio = Math.max(0, Math.min(1, zoomAnchor.ratio));
    const visibleWidth = 1 / zoomX;
    let minX = anchorTime - (visibleWidth * anchorRatio);
    let maxX = minX + visibleWidth;

    if (minX < 0) {
      maxX += -minX;
      minX = 0;
    }
    if (maxX > 1) {
      minX -= maxX - 1;
      maxX = 1;
    }

    return {
      ...DEFAULT_CURVE_VIEWPORT,
      timeMin: Math.max(0, minX),
      timeMax: Math.min(1, maxX),
    };
  }, [zoomAnchor, zoomX]);

  const viewMinX = computedViewport.timeMin;
  const viewMaxX = computedViewport.timeMax;
  const explicitlySelectedCurvePoint = selectedPoint
    ? activeCurveData[selectedPoint.channel]?.find(point => point.id === selectedPoint.pointId) ?? null
    : null;
  const fallbackFocusedPoint = useMemo(() => {
    if (explicitlySelectedCurvePoint) return null;

    const targetTime = displayDomainTime ?? 0.5;
    return editableChannels.reduce((nearest, channel) => {
      return activeCurveData[channel].reduce((channelNearest, point) => {
        const distance = Math.abs(point.time - targetTime);
        const middleBias = Math.abs(point.time - 0.5);
        if (
          !channelNearest ||
          distance < channelNearest.distance ||
          (Math.abs(distance - channelNearest.distance) <= POINT_EPSILON && middleBias < channelNearest.middleBias)
        ) {
          return { channel, point, distance, middleBias };
        }
        return channelNearest;
      }, nearest);
    }, null as { channel: Channel; point: CurvePoint; distance: number; middleBias: number } | null);
  }, [activeCurveData, displayDomainTime, editableChannels, explicitlySelectedCurvePoint]);
  const focusedPointRef = selectedPoint && explicitlySelectedCurvePoint
    ? { channel: selectedPoint.channel, point: explicitlySelectedCurvePoint }
    : fallbackFocusedPoint;
  const focusedCurvePoint = focusedPointRef?.point ?? null;
  const focusedPointLabel = focusedPointRef
    ? `${focusedPointRef.channel.toUpperCase()}:${activeCurveData[focusedPointRef.channel].findIndex(point => point.id === focusedPointRef.point.id) + 1}`
    : 'POINT: NONE';

  const horizontalStripGradient = useMemo(() => {
    const sortedCurve = {
      r: [...curve.r].sort((a, b) => a.time - b.time),
      g: [...curve.g].sort((a, b) => a.time - b.time),
      b: [...curve.b].sort((a, b) => a.time - b.time),
      a: [...curve.a].sort((a, b) => a.time - b.time),
    };

    const tangents = {
      r: computeTangents(sortedCurve.r),
      g: computeTangents(sortedCurve.g),
      b: computeTangents(sortedCurve.b),
      a: computeTangents(sortedCurve.a),
    };

    const stops: string[] = [];
    const steps = 30;
    const visibleDomainWidth = viewMaxX - viewMinX;

    for (let i = 0; i <= steps; i++) {
      const localT = i / steps;
      const targetTime = viewMinX + (localT * visibleDomainWidth);
      const r = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.r, tangents.r, targetTime, interpMode))) * 255
      );
      const g = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.g, tangents.g, targetTime, interpMode))) * 255
      );
      const b = Math.round(
        Math.max(0, Math.min(1, evaluateCurve(sortedCurve.b, tangents.b, targetTime, interpMode))) * 255
      );
      const a = Math.max(0, Math.min(1, evaluateCurve(sortedCurve.a, tangents.a, targetTime, interpMode)));

      stops.push(`rgba(${r},${g},${b},${a}) ${localT * 100}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [curve, interpMode, viewMaxX, viewMinX]);

  const curveToScreen = (time: number, value: number, sourceViewport = computedViewport) => ({
    x: timeToX(time, sourceViewport, PLOT_RECT),
    y: valueToY(value, sourceViewport, PLOT_RECT)
  });

  const screenToCurve = (point: { x: number; y: number }, sourceViewport = computedViewport) => ({
    time: xToTime(point.x, sourceViewport, PLOT_RECT),
    value: yToValue(point.y, sourceViewport, PLOT_RECT)
  });

  const clampDisplayValue = (value: number, sourceViewport = computedViewport) =>
    Math.max(sourceViewport.valueMin, Math.min(sourceViewport.valueMax, value));

  const scheduleCursorValue = (value: { time: number; value: number }) => {
    pendingCursorValueRef.current = value;
    if (cursorFrameRef.current !== null) return;

    cursorFrameRef.current = window.requestAnimationFrame(() => {
      cursorFrameRef.current = null;
      const nextValue = pendingCursorValueRef.current;
      pendingCursorValueRef.current = null;
      if (nextValue) setCursorValue(nextValue);
    });
  };

  const publishDragCurve = (nextCurve: ColorCurve) => {
    liveCurveRef.current = nextCurve;
    pendingCurveRef.current = nextCurve;
    if (curveFrameRef.current !== null) return;

    curveFrameRef.current = window.requestAnimationFrame(() => {
      curveFrameRef.current = null;
      const curveToPublish = pendingCurveRef.current;
      pendingCurveRef.current = null;
      if (!curveToPublish) return;

      setLocalCurve(curveToPublish);
      onChange(curveToPublish);
    });
  };

  const cancelPendingDragCurvePublish = () => {
    if (curveFrameRef.current !== null) {
      window.cancelAnimationFrame(curveFrameRef.current);
      curveFrameRef.current = null;
    }
    pendingCurveRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current);
      }
      if (curveFrameRef.current !== null) {
        window.cancelAnimationFrame(curveFrameRef.current);
      }
    };
  }, []);

  const adjustZoom = (factor: number) => {
    setZoomAnchor(latestCursorAnchorRef.current);
    setZoomX((currentZoom) => Math.max(MIN_ZOOM_X, Math.min(MAX_ZOOM_X, currentZoom * factor)));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGElement>, channel: Channel, pointIndex: number) => {
    if (e.button !== 0) return;
    if (!editChannels[channel]) return;
    const point = curve[channel][pointIndex];
    e.stopPropagation();
    onActiveChannelChange(channel);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const nextSelection = { channel, pointId: point.id };
      setMultiSelectedPoints(current => isMultiSelected(nextSelection)
        ? current.filter(selection => selection.channel !== channel || selection.pointId !== point.id)
        : [...current, nextSelection]
      );
      onSelectedPointChange(nextSelection);
      return;
    }
    const pointIsMultiSelected = isMultiSelected({ channel, pointId: point.id });
    if (!pointIsMultiSelected) {
      setMultiSelectedPoints([]);
    }
    onSelectedPointChange({ channel, pointId: point.id });
    if (!canDragPoint(point)) return;
    setLocalCurve(curve);
    liveCurveRef.current = curve;
    dragGestureRef.current = {
      channel,
      pointId: point.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      hasMoved: false,
      startCurvePoint: { time: point.time, value: point.value },
      multiDrag: pointIsMultiSelected && multiSelectedPoints.length > 1,
      startCurve: curve,
    };
    setDraggingPoint({ channel, pointId: point.id });
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

  const getPlotRatio = (x: number) =>
    Math.max(0, Math.min(1, (x - PLOT_RECT.left) / PLOT_RECT.width));

  const getDomainTimeFromSvgPoint = (point: { x: number; y: number }) =>
    Math.max(0, Math.min(1, screenToCurve(point).time));

  const updateDomainTimeFromSvgPoint = (point: { x: number; y: number }, commit = false) => {
    const nextTime = Math.max(0, Math.min(1, screenToCurve(point).time));
    onDomainTimeChange?.(nextTime, { commit });
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (event.deltaY === 0) return;
    event.preventDefault();

    const svgPoint = getSvgPoint(event.clientX, event.clientY);
    if (svgPoint) {
      setZoomAnchor({
        time: screenToCurve(svgPoint).time,
        ratio: getPlotRatio(svgPoint.x),
      });
    }

    setZoomX((currentZoom) =>
      Math.max(MIN_ZOOM_X, Math.min(MAX_ZOOM_X, currentZoom * Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY)))
    );
  };

  const detectEditableChannel = (time: number, value: number) => {
    if (editableChannels.length === 0) return null;
    if (editChannels[activeChannel]) return activeChannel;
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

  const getBoxSelectionRefs = (box: BoxSelection): SelectedPointRef[] => {
    const minX = Math.min(box.start.x, box.current.x);
    const maxX = Math.max(box.start.x, box.current.x);
    const minY = Math.min(box.start.y, box.current.y);
    const maxY = Math.max(box.start.y, box.current.y);

    return editableChannels.flatMap(channel =>
      activeCurveData[channel].filter(point => {
        const screenPoint = curveToScreen(point.time, point.value);
        return screenPoint.x >= minX
          && screenPoint.x <= maxX
          && screenPoint.y >= minY
          && screenPoint.y <= maxY;
      }).map(point => ({ channel, pointId: point.id }))
    );
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;

    const point = getSvgPoint(e.clientX, e.clientY);
    if (!point) return;
    if (findNearestEditablePoint(point)) return;

    e.preventDefault();
    if (displayDomainTime !== undefined && onDomainTimeChange) {
      const guideX = timeToX(displayDomainTime, computedViewport, PLOT_RECT);
      const isInGuideX = Math.abs(point.x - guideX) <= DOMAIN_GUIDE_HIT_RADIUS;
      const isInGuideY = point.y >= PLOT_RECT.top && point.y <= PLOT_RECT.bottom + 14;
      if (isInGuideX && isInGuideY) {
        setDomainGuideDrag({ pointerId: e.pointerId });
        setLiveDomainTime(getDomainTimeFromSvgPoint(point));
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    setBoxSelection({
      pointerId: e.pointerId,
      start: point,
      current: point,
      hasMoved: false,
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svgPoint = getSvgPoint(e.clientX, e.clientY);
    if (svgPoint) {
      const nextCursorValue = screenToCurve(svgPoint);
      scheduleCursorValue(nextCursorValue);
      latestCursorAnchorRef.current = {
        time: nextCursorValue.time,
        ratio: getPlotRatio(svgPoint.x),
      };
    }

    if (domainGuideDrag) {
      if (!svgPoint || domainGuideDrag.pointerId !== e.pointerId) return;
      e.preventDefault();
      setLiveDomainTime(getDomainTimeFromSvgPoint(svgPoint));
      return;
    }

    if (boxSelection) {
      if (!svgPoint) return;
      setBoxSelection(current => {
        if (!current) return null;
        const dx = svgPoint.x - current.start.x;
        const dy = svgPoint.y - current.start.y;
        return {
          ...current,
          current: svgPoint,
          hasMoved: current.hasMoved || Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX,
        };
      });
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

    if (dragGesture.multiDrag) {
      const deltaTime = (newTime - dragGesture.startCurvePoint.time) * 0.5;
      const deltaValue = (newValue - dragGesture.startCurvePoint.value) * 0.5;
      let nextCurve = dragGesture.startCurve;

      for (const targetChannel of CHANNELS) {
        const channelSelections = multiSelectedPoints.filter(selection => selection.channel === targetChannel);
        if (channelSelections.length === 0) continue;

        const channelData = [...nextCurve[targetChannel]];
        for (const selection of channelSelections) {
          const selectedIndex = channelData.findIndex(candidate => candidate.id === selection.pointId);
          if (selectedIndex === -1) continue;
          const selectedPoint = channelData[selectedIndex];
          if (!canDragPoint(selectedPoint)) continue;

          const constrainedMove = applyPointMoveConstraints(
            channelData,
            selectedIndex,
            {
              time: selectedPoint.time + deltaTime,
              value: selectedPoint.value + deltaValue,
            },
            POINT_EPSILON
          );

          channelData[selectedIndex] = {
            ...selectedPoint,
            time: constrainedMove.time,
            value: constrainedMove.value,
          };
        }

        nextCurve = {
          ...nextCurve,
          [targetChannel]: channelData
        };
      }

      liveCurveRef.current = nextCurve;
      publishDragCurve(nextCurve);
      return;
    }

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
    
    publishDragCurve(newCurve);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (domainGuideDrag && domainGuideDrag.pointerId === e.pointerId) {
      const svgPoint = getSvgPoint(e.clientX, e.clientY);
      if (svgPoint) {
        updateDomainTimeFromSvgPoint(svgPoint, true);
      } else if (liveDomainTime !== null) {
        onDomainTimeChange?.(liveDomainTime, { commit: true });
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDomainGuideDrag(null);
      setLiveDomainTime(null);
      return;
    }

    if (boxSelection && boxSelection.pointerId === e.pointerId) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      if (boxSelection.hasMoved) {
        const selectedRefs = getBoxSelectionRefs(boxSelection);
        setMultiSelectedPoints(selectedRefs);
        if (selectedRefs.length > 0) {
          onActiveChannelChange(selectedRefs[selectedRefs.length - 1].channel);
          onSelectedPointChange(selectedRefs[selectedRefs.length - 1]);
        } else {
          onSelectedPointChange(null);
        }
      }

      setBoxSelection(null);
      return;
    }

    if (draggingPoint) {
      const target = e.target as Element;
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }

      if (dragGestureRef.current?.hasMoved) {
        cancelPendingDragCurvePublish();
        const currentCurve = liveCurveRef.current;
        const channelsToOrder = dragGestureRef.current.multiDrag
          ? Array.from(new Set(multiSelectedPoints.map(selection => selection.channel)))
          : [draggingPoint.channel];
        const newCurve = channelsToOrder.reduce((nextCurve, channel) => ({
          ...nextCurve,
          [channel]: orderCurvePoints([...nextCurve[channel]])
        }), currentCurve);
        
        liveCurveRef.current = newCurve;
        setLocalCurve(newCurve);
        onChange(newCurve);
      }

      dragGestureRef.current = null;
      setDraggingPoint(null);
    }
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const point = getSvgPoint(e.clientX, e.clientY);
    if (!point) return;

    const nearestPoint = findNearestEditablePoint(point);
    if (nearestPoint) {
      e.preventDefault();
      onActiveChannelChange(nearestPoint.channel);
      setMultiSelectedPoints([]);
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
    setMultiSelectedPoints([]);
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
    setMultiSelectedPoints(current =>
      current.filter(selection => selection.channel !== channel || selection.pointId !== point.id)
    );
    if (selectedPoint?.channel === channel && selectedPoint.pointId === point.id) {
      onSelectedPointChange(null);
    }
    onChange(newCurve);
  };

  const selectedTransformSummary = useMemo(() => {
    const points = multiSelectedPoints
      .map(selection => activeCurveData[selection.channel].find(point => point.id === selection.pointId))
      .filter((point): point is CurvePoint => Boolean(point));
    if (points.length <= 1) return null;

    const minTime = Math.min(...points.map(point => point.time));
    const maxTime = Math.max(...points.map(point => point.time));
    const minValue = Math.min(...points.map(point => point.value));
    const maxValue = Math.max(...points.map(point => point.value));

    return {
      count: points.length,
      centerTime: (minTime + maxTime) / 2,
      centerValue: (minValue + maxValue) / 2,
      timeSpan: maxTime - minTime,
      valueSpan: maxValue - minValue,
    };
  }, [activeCurveData, multiSelectedPoints]);

  const scaleSelectedSpan = (axis: 'time' | 'value', nextSpan: number) => {
    if (!selectedTransformSummary) return;
    const currentSpan = axis === 'time'
      ? selectedTransformSummary.timeSpan
      : selectedTransformSummary.valueSpan;
    const center = axis === 'time'
      ? selectedTransformSummary.centerTime
      : selectedTransformSummary.centerValue;
    const scale = Math.max(MIN_TRANSFORM_SPAN, nextSpan) / Math.max(MIN_TRANSFORM_SPAN, currentSpan);
    let nextCurve = activeCurveData;

    for (const channel of CHANNELS) {
      const channelSelections = multiSelectedPoints.filter(selection => selection.channel === channel);
      if (channelSelections.length === 0) continue;

      const channelData = [...nextCurve[channel]];
      for (const selection of channelSelections) {
        const index = channelData.findIndex(point => point.id === selection.pointId);
        if (index === -1) continue;
        const point = channelData[index];
        if (!canDragPoint(point)) continue;

        const target = axis === 'time'
          ? {
              time: center + ((point.time - center) * scale),
              value: point.value,
            }
          : {
              time: point.time,
              value: center + ((point.value - center) * scale),
            };
        const constrained = applyPointMoveConstraints(channelData, index, target, POINT_EPSILON);
        channelData[index] = {
          ...point,
          time: constrained.time,
          value: constrained.value,
        };
      }

      nextCurve = {
        ...nextCurve,
        [channel]: orderCurvePoints(channelData)
      };
    }

    setLocalCurve(nextCurve);
    onChange(nextCurve);
  };

  const curvePaths: Record<Channel, string> = {
    r: useMemo(
      () => buildDisplayCurvePath(activeCurveData.r, computedViewport, interpMode),
      [activeCurveData.r, computedViewport, interpMode]
    ),
    g: useMemo(
      () => buildDisplayCurvePath(activeCurveData.g, computedViewport, interpMode),
      [activeCurveData.g, computedViewport, interpMode]
    ),
    b: useMemo(
      () => buildDisplayCurvePath(activeCurveData.b, computedViewport, interpMode),
      [activeCurveData.b, computedViewport, interpMode]
    ),
    a: useMemo(
      () => buildDisplayCurvePath(activeCurveData.a, computedViewport, interpMode),
      [activeCurveData.a, computedViewport, interpMode]
    ),
  };

  const drawGrid = () => {
    const lines = [];

    for (const tick of buildTicks(computedViewport.valueMin, computedViewport.valueMax, 4)) {
      const y = valueToY(tick.value, computedViewport, PLOT_RECT);
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

    const tickSpacing = zoomX > 16 ? 0.01 : zoomX > 8 ? 0.02 : zoomX > 4 ? 0.05 : 0.1;
    const firstTick = Math.ceil(viewMinX / tickSpacing) * tickSpacing;

    for (let tickValue = firstTick; tickValue <= viewMaxX + tickSpacing * 0.5; tickValue += tickSpacing) {
      const roundedTick = Number(tickValue.toFixed(4));
      if (roundedTick < viewMinX - POINT_EPSILON || roundedTick > viewMaxX + POINT_EPSILON) continue;
      const x = timeToX(roundedTick, computedViewport, PLOT_RECT);
      const labelPrecision = tickSpacing < 0.1 ? 2 : 1;

      lines.push(
        <line
          key={`v-${roundedTick}`}
          x1={x}
          y1={PLOT_RECT.top}
          x2={x}
          y2={PLOT_RECT.bottom}
          stroke="#3f3f46"
          strokeWidth={1}
        />
      );
      lines.push(
        <text key={`vt-${roundedTick}`} x={x} y={PLOT_RECT.bottom + 15} fill="#a1a1aa" fontSize="12" textAnchor="middle">
          {roundedTick.toFixed(labelPrecision)}
        </text>
      );
    }
    return lines;
  };

  const drawCurve = (channel: Channel) => {
    const data = activeCurveData[channel];
    if (data.length === 0) return null;
    const pathD = curvePaths[channel];
    
    const isDraggingThis = draggingPoint?.channel === channel;
    const isEditable = editChannels[channel];
    const showPoints = isEditable;
    const strokeOpacity = isEditable ? 1 : 0.3;
    const strokeWidth = isEditable ? 2 : 1.25;

    const startBoundary = data.find(point => getEdgeOwner(point) === 'start') ?? data[0];
    const endBoundary = data.find(point => getEdgeOwner(point) === 'end') ?? data[data.length - 1];
    const extensionOpacity = Math.min(strokeOpacity, 0.18);

    return (
      <g key={channel} clipPath={`url(#${plotClipId})`}>
        {startBoundary.time > POINT_EPSILON && (
          <line
            x1={timeToX(0, computedViewport, PLOT_RECT)}
            y1={valueToY(clampDisplayValue(startBoundary.value), computedViewport, PLOT_RECT)}
            x2={timeToX(startBoundary.time, computedViewport, PLOT_RECT)}
            y2={valueToY(clampDisplayValue(startBoundary.value), computedViewport, PLOT_RECT)}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={1.5}
            opacity={extensionOpacity}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {endBoundary.time < 1 - POINT_EPSILON && (
          <line
            x1={timeToX(endBoundary.time, computedViewport, PLOT_RECT)}
            y1={valueToY(clampDisplayValue(endBoundary.value), computedViewport, PLOT_RECT)}
            x2={timeToX(1, computedViewport, PLOT_RECT)}
            y2={valueToY(clampDisplayValue(endBoundary.value), computedViewport, PLOT_RECT)}
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
            const { x, y } = curveToScreen(k.time, k.value, computedViewport);
            const canRemove = data.length > 2 && canDeletePoint(k);
            const isSelected = selectedPoint?.channel === channel && selectedPoint.pointId === k.id;
            const isMultiPointSelected = isMultiSelected({ channel, pointId: k.id });
            const isSoftFocused = !selectedPoint && focusedPointRef?.channel === channel && focusedPointRef.point.id === k.id;
            const isDraggingPoint = isDraggingThis && draggingPoint?.pointId === k.id;
            const radius = isDraggingPoint ? 8 : 6;
            const canMove = canDragPoint(k);
            const isProtected = k.flags.includes('protected');
            const isPreserved = k.flags.includes('uncompressible');
            const markerOpacity = k.role === 'sample' ? 0.62 : 1;
            const markerStroke = isProtected ? '#f8fafc' : (isSelected || isSoftFocused || isMultiPointSelected) ? '#ffffff' : '#18181b';
            const markerStrokeWidth = isProtected || isSelected || isSoftFocused || isMultiPointSelected ? 2.5 : 2;
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
                    {(isSelected || isSoftFocused || isMultiPointSelected) && (
                      <circle
                          cx={x}
                          cy={y}
                          r={radius + 5}
                          fill="none"
                          stroke="white"
                          strokeWidth={1.25}
                          opacity={isSelected ? 0.72 : isMultiPointSelected ? 0.58 : 0.38}
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

  const drawDomainTimeGuide = () => {
    if (displayDomainTime === undefined) return null;
    if (displayDomainTime < viewMinX || displayDomainTime > viewMaxX) return null;

    const x = timeToX(displayDomainTime, computedViewport, PLOT_RECT);

    return (
      <g pointerEvents="none">
        <line
          x1={x}
          y1={PLOT_RECT.top}
          x2={x}
          y2={PLOT_RECT.bottom}
          stroke="#f8fafc"
          strokeWidth="1.5"
          strokeDasharray="6 6"
          opacity="0.75"
        />
        <line
          x1={x}
          y1={PLOT_RECT.bottom + 3}
          x2={x}
          y2={PLOT_RECT.bottom + 11}
          stroke="#f8fafc"
          strokeWidth="1.5"
          opacity="0.75"
        />
      </g>
    );
  };

  const drawBoxSelection = () => {
    if (!boxSelection || !boxSelection.hasMoved) return null;

    const x = Math.min(boxSelection.start.x, boxSelection.current.x);
    const y = Math.min(boxSelection.start.y, boxSelection.current.y);
    const width = Math.abs(boxSelection.current.x - boxSelection.start.x);
    const height = Math.abs(boxSelection.current.y - boxSelection.start.y);

    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="rgba(255,255,255,0.08)"
        stroke="#f8fafc"
        strokeWidth="1.25"
        strokeDasharray="5 5"
        pointerEvents="none"
      />
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
        "w-full min-h-[240px] relative select-none rounded-xl bg-[#09090b] border border-zinc-800 overflow-hidden shadow-2xl outline-none p-1.5 flex flex-col gap-1",
        className ?? "h-full"
      )}
      tabIndex={0}
    >
      <div
        className="flex w-full shrink-0 flex-col items-start justify-start bg-[#09090b]"
        style={{ width: `min(100%, ${lockedPlotWidth}px)` }}
      >
        <div
          style={{ height: PREVIEW_STRIP_HEIGHT }}
          className="relative w-full shrink-0 overflow-hidden rounded border border-zinc-800/80 opacity-90 shadow-inner"
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: '#0b0b0c',
              backgroundImage: `
                linear-gradient(45deg, #27272a 25%, transparent 25%),
                linear-gradient(-45deg, #27272a 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #27272a 75%),
                linear-gradient(-45deg, transparent 75%, #27272a 75%)`,
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            }}
          />
          <div
            className="absolute bottom-0 top-0"
            style={{
              ...PREVIEW_INSET,
              background: horizontalStripGradient,
            }}
          />
        </div>

        <div className="mt-1 w-full overflow-hidden bg-[#09090b]">
          <div
            className="relative w-full shrink-0 overflow-hidden rounded border border-zinc-900/80 bg-[#09090b]"
            style={{
              aspectRatio: `${WIDTH} / ${HEIGHT}`,
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="xMinYMin meet"
              className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
              onPointerMove={handlePointerMove}
              onPointerDown={handleSvgPointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleSvgDoubleClick}
              onWheel={handleWheel}
            >
              <defs>
                <clipPath id={plotClipId}>
                  <rect
                    x={PLOT_RECT.left - PLOT_CLIP_BLEED}
                    y={PLOT_RECT.top - PLOT_CLIP_BLEED}
                    width={PLOT_RECT.width + PLOT_CLIP_BLEED * 2}
                    height={PLOT_RECT.height + PLOT_CLIP_BLEED * 2}
                  />
                </clipPath>
              </defs>
              {drawGrid()}
              {drawDomainTimeGuide()}
              {CHANNELS.map(ch => drawCurve(ch))}
              {drawBoxSelection()}
            </svg>
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-zinc-800 bg-black/80 p-1 shadow-xl backdrop-blur">
              <button
                type="button"
                title="Zoom out"
                aria-label="Zoom out"
                onClick={() => adjustZoom(1 / ZOOM_BUTTON_FACTOR)}
                className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Fit view"
                aria-label="Fit view"
                onClick={() => setZoomX(MIN_ZOOM_X)}
                className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Zoom in"
                aria-label="Zoom in"
                onClick={() => adjustZoom(ZOOM_BUTTON_FACTOR)}
                className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] text-zinc-500 drop-shadow-md">
              {cursorValue
                ? `T ${cursorValue.time.toFixed(3)}  V ${cursorValue.value.toFixed(3)}`
                : 'Double-click add point'}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          height: CONTROL_BAR_HEIGHT,
          width: `min(100%, ${lockedPlotWidth}px)`,
        }}
        className="flex w-full shrink-0 flex-row items-center justify-between gap-3 border-t border-zinc-900/80 pt-1"
      >
        <div
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: SVG_MARGIN.left }}
        >
          <div className="hidden truncate font-mono text-[10px] tracking-wider text-zinc-500 lg:block">
            DOMAIN: <span className="font-bold text-zinc-400">[ 0.000 ] - [ 1.000 ]</span>
          </div>
        </div>

        <div
          className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10px] tracking-wider text-zinc-500"
          style={{ paddingRight: SVG_MARGIN.right }}
        >
          {curveIndexLabel && (
            <span
              className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-bold text-zinc-300"
              title={curveIndexTitle}
            >
              {curveIndexLabel}
            </span>
          )}
          <span className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-bold text-zinc-300">
            {focusedPointLabel}
          </span>
          <span className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400">
            {focusedCurvePoint?.source.toUpperCase() ?? 'UNSELECTED'}
          </span>
          <span className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400">
            {focusedCurvePoint?.continuity.toUpperCase() ?? 'SMOOTH'}
          </span>
          <span className="shrink-0 text-right text-zinc-400">
            T <span className="inline-block w-10 text-zinc-300">{(focusedCurvePoint?.time ?? cursorValue?.time ?? 0).toFixed(3)}</span>
          </span>
          <span className="shrink-0 text-right text-zinc-400">
            V <span className="inline-block w-10 text-zinc-300">{(focusedCurvePoint?.value ?? cursorValue?.value ?? 0).toFixed(3)}</span>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#09090b] px-2 py-1">
        {selectedTransformSummary && (
          <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded border border-zinc-900/90 bg-black/40 p-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span className="mr-2 font-bold text-zinc-300">
              {selectedTransformSummary.count} Points
            </span>
            <label className="inline-flex items-center gap-1">
              T Span
              <span className="text-zinc-500">[</span>
              <span className="w-10 text-right text-zinc-300">{selectedTransformSummary.timeSpan.toFixed(3)}</span>
              <input
                type="range"
                min={MIN_TRANSFORM_SPAN}
                max="1"
                step="0.001"
                value={Math.max(MIN_TRANSFORM_SPAN, selectedTransformSummary.timeSpan)}
                onChange={(event) => scaleSelectedSpan('time', Number(event.target.value))}
                className="h-1 w-24 accent-zinc-300"
                aria-label="Scale selected point time span"
              />
              <span className="text-zinc-500">]</span>
            </label>
            <label className="inline-flex items-center gap-1">
              V Span
              <span className="text-zinc-500">[</span>
              <span className="w-10 text-right text-zinc-300">{selectedTransformSummary.valueSpan.toFixed(3)}</span>
              <input
                type="range"
                min={MIN_TRANSFORM_SPAN}
                max="2"
                step="0.001"
                value={Math.max(MIN_TRANSFORM_SPAN, selectedTransformSummary.valueSpan)}
                onChange={(event) => scaleSelectedSpan('value', Number(event.target.value))}
                className="h-1 w-24 accent-zinc-300"
                aria-label="Scale selected point value span"
              />
              <span className="text-zinc-500">]</span>
            </label>
            <span className="text-zinc-600">Drag selected point to move group at 50% sensitivity</span>
            <button
              type="button"
              title="Clear multi-point selection"
              aria-label="Clear multi-point selection"
              onClick={() => setMultiSelectedPoints([])}
              className="ml-auto h-7 rounded border border-zinc-800 px-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-100"
            >
              Clear
            </button>
          </div>
        )}
        {!selectedTransformSummary && (
          <div className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            <span className="rounded border border-zinc-900 bg-zinc-950 px-1 py-px text-zinc-500" title="Drag empty plot to box select · Double-click to add · Right-click point to remove · Wheel to zoom">?</span>
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all group-hover:max-w-[34rem] group-hover:opacity-100 group-focus-within:max-w-[34rem] group-focus-within:opacity-100">
              Drag empty plot to box select · Double-click to add · Right-click point to remove · Wheel to zoom
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
