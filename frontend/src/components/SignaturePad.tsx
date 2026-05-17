import { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, PenLine } from 'lucide-react';

interface Props {
  onSign: (dataUrl: string) => void;
  height?: number;
}

const MIN_PATH_LENGTH = 30; // canvas pixels — prevents a single tap from counting

export default function SignaturePad({ onSign, height = 150 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const isEmptyRef = useRef(true);
  const totalPathLength = useRef(0); // accumulated drawn length per stroke

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as MouseEvent).clientY - rect.top) * scaleY,
    };
  };

  // Fill canvas with white on mount so exported PNG has white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setIsDrawing(true);
    totalPathLength.current = 0;
    lastPos.current = getPos(e, canvas);
  }, []);

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    // Accumulate path length to detect trivial taps
    const dx = pos.x - lastPos.current!.x;
    const dy = pos.y - lastPos.current!.y;
    totalPathLength.current += Math.sqrt(dx * dx + dy * dy);

    ctx.strokeStyle = '#1e293b'; // dark navy — readable on white background
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    isEmptyRef.current = false;
    setIsEmpty(false);
  }, [isDrawing]);

  const stopDraw = useCallback(() => {
    setIsDrawing(false);
    totalPathLength.current = 0;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Mouse events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);

    // Touch events
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDraw);
    };
  }, [startDraw, draw, stopDraw]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Restore white background after clearing
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    isEmptyRef.current = true;
    totalPathLength.current = 0;
    setIsEmpty(true);
    onSign('');
  };

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-navy-light/40 rounded-xl overflow-hidden hover:border-gold/30 transition-colors">
        <canvas
          ref={canvasRef}
          width={600}
          height={height}
          tabIndex={0}
          className="w-full cursor-crosshair touch-none block bg-white focus:outline-none focus:ring-2 focus:ring-gold/50"
          style={{ height: `${height}px` }}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <PenLine className="w-6 h-6 text-gray-400" />
            <p className="text-gray-400 text-sm">Draw your signature here</p>
          </div>
        )}
        {/* Signature baseline */}
        <div className="absolute bottom-7 left-8 right-8 border-b border-dotted border-gray-300 pointer-events-none" />
        <p className="absolute bottom-2 left-8 text-[10px] text-gray-400 pointer-events-none tracking-wide">SIGNATURE</p>
        {!isEmpty && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
            <span className="text-[10px] text-emerald-400 font-medium">Signed</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={isEmpty}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy-light/20 hover:bg-navy-light/40 disabled:opacity-30 text-gray-400 hover:text-white text-xs font-medium transition-all"
        >
          <Eraser className="w-3.5 h-3.5" /> Clear
        </button>
        <button
          type="button"
          onClick={() => {
            if (!isEmpty && canvasRef.current) {
              onSign(canvasRef.current.toDataURL('image/png'));
            }
          }}
          disabled={isEmpty}
          className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 disabled:opacity-30 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition-all"
        >
          Done Signing ✓
        </button>
      </div>
    </div>
  );
}
