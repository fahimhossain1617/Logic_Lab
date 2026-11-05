import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ExplainLanguage, TraceStep } from '../../../shared/types';
import { FormattedText } from '../common/FormattedText';

interface SwapBucketsRendererProps {
  step: TraceStep;
  prevStep: TraceStep | null;
  explainLanguage: ExplainLanguage;
  hoveredVariable: string | null;
  reduceMotion: boolean;
}

const CUP_PALETTE = [
  { color: '#A3C1FF', liquidGradId: 'grad-cup-0' },
  { color: '#B79CFF', liquidGradId: 'grad-cup-1' },
  { color: '#FFB26B', liquidGradId: 'grad-cup-2' },
];

export const SwapBucketsRenderer: React.FC<SwapBucketsRendererProps> = ({
  step,
  explainLanguage,
  hoveredVariable,
  reduceMotion,
}) => {
  const vars = step.variables || {};
  const varKeys = Object.keys(vars);

  // Dynamically determine the up to 3 cup names from the user's actual variables
  let cupOrder: string[] = ['a', 'temp', 'b'];
  const hasCanonical = varKeys.some((k) => ['a', 'b', 'temp'].includes(k));
  if (!hasCanonical && varKeys.length > 0) {
    cupOrder = varKeys.slice(0, 3);
    while (cupOrder.length < 3) {
      const fallbackName = cupOrder.length === 1 ? 'temp' : `var${cupOrder.length + 1}`;
      if (!cupOrder.includes(fallbackName)) cupOrder.push(fallbackName);
      else cupOrder.push(`slot${cupOrder.length + 1}`);
    }
  } else if (hasCanonical) {
    const extras = varKeys.filter((k) => !['a', 'b', 'temp'].includes(k));
    if (!('temp' in vars) && extras.length > 0) {
      cupOrder = ['a', extras[0], 'b'];
    }
  }

  const activeFrom = step.from || null;
  const activeTo = step.to || null;
  const isLostFault = step.fault?.type === 'lost_value';
  const faultTarget = step.fault?.target || cupOrder[0];

  const cupXCenters: Record<string, number> = {
    [cupOrder[0]]: 130,
    [cupOrder[1]]: 300,
    [cupOrder[2]]: 470,
  };

  const showPourStream =
    (step.action === 'transfer' || step.action === 'assign' || step.action === 'halt') &&
    activeFrom &&
    activeTo &&
    cupXCenters[activeFrom] !== undefined &&
    cupXCenters[activeTo] !== undefined &&
    activeFrom !== activeTo;

  const fromX = activeFrom && cupXCenters[activeFrom] ? cupXCenters[activeFrom] : 130;
  const toX = activeTo && cupXCenters[activeTo] ? cupXCenters[activeTo] : 300;
  const midX = (fromX + toX) / 2;
  const arcTopY = Math.abs(fromX - toX) > 200 ? 18 : 38;
  const streamPath = `M ${fromX} 102 Q ${midX} ${arcTopY} ${toX} 106`;

  return (
    <div
      className="relative flex flex-col items-center justify-center w-full h-full min-h-[290px] px-3 sm:px-5 py-3 select-none overflow-hidden"
      data-testid="renderer-swap-buckets"
    >
      {/* Top Action Tag */}
      <div className="flex items-center justify-between w-full max-w-[580px] mb-3 text-xs gap-3">
        <span className="text-[var(--text-muted)] font-medium truncate">
          {explainLanguage === 'bn'
            ? 'বাস্তব উদাহরণ: তরলের কাপ (Liquid Cups)'
            : 'Real-World Analogy: Liquid Cups'}
        </span>
        <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-semibold shrink-0">
          {step.action.toUpperCase()} · Ln {step.activeLine}
        </span>
      </div>

      {/* Main SVG Stage */}
      <div className="relative w-full max-w-[580px] aspect-[600/270]">
        <svg
          viewBox="0 0 600 270"
          className="w-full h-full overflow-hidden"
          role="img"
          aria-label={
            explainLanguage === 'bn'
              ? 'ভ্যারিয়েবল অদলবদলের কাপ অ্যানিমেশন'
              : 'Variable swap cup animation'
          }
        >
          <defs>
            <linearGradient id="grad-cup-0" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A3C1FF" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#3B68D1" stopOpacity="0.88" />
            </linearGradient>
            <linearGradient id="grad-cup-1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B79CFF" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#6D48D6" stopOpacity="0.88" />
            </linearGradient>
            <linearGradient id="grad-cup-2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFB26B" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#D96B27" stopOpacity="0.88" />
            </linearGradient>
            <linearGradient id="grad-stream" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#A3C1FF" />
              <stop offset="50%" stopColor="#EEF3FF" />
              <stop offset="100%" stopColor="#FFB26B" />
            </linearGradient>
            <clipPath id="cup-interior-clip">
              <path d="M -44 0 L -36 112 Q -35 122 -24 122 L 24 122 Q 35 122 36 112 L 44 0 Z" />
            </clipPath>
          </defs>

          {/* Soft Glass Shelf */}
          <rect
            x="44"
            y="224"
            width="512"
            height="10"
            rx="5"
            fill="rgba(163, 193, 255, 0.16)"
            stroke="rgba(163, 193, 255, 0.28)"
            strokeWidth="1"
          />

          {/* Pouring Stream Arc */}
          <AnimatePresence>
            {showPourStream && (
              <g key={`pour-${step.stepIndex}`}>
                <motion.path
                  d={streamPath}
                  fill="none"
                  stroke={isLostFault ? '#FF6B7D' : 'url(#grad-stream)'}
                  strokeWidth="6"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.01 : 0.48, ease: [0.22, 1, 0.36, 1] }}
                />
                {!reduceMotion &&
                  [0, 1, 2].map((bIdx) => (
                    <motion.circle
                      key={bIdx}
                      r="4.5"
                      fill={isLostFault ? '#FF6B7D' : '#EEF3FF'}
                      initial={{ cx: fromX, cy: 98, opacity: 0 }}
                      animate={{
                        cx: [fromX, midX, toX],
                        cy: [98, arcTopY + 12, 114],
                        opacity: [0, 1, 0],
                      }}
                      transition={{
                        duration: 0.9,
                        delay: bIdx * 0.18,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
              </g>
            )}
          </AnimatePresence>

          {/* Render the 3 Cups */}
          {cupOrder.map((cupKey, cupIdx) => {
            const cx = cupXCenters[cupKey];
            const val = vars[cupKey];
            const hasValue = val !== undefined && val !== null;
            const numericVal = typeof val === 'number' ? Math.abs(val) : hasValue ? 6 : 0;
            const fillRatio = hasValue ? Math.min(0.82, Math.max(0.4, numericVal / 15)) : 0;
            const cupHeight = 122;
            const liquidHeight = Math.round(cupHeight * fillRatio);
            const liquidTopY = cupHeight - liquidHeight;

            const isSource = activeFrom === cupKey;
            const isTarget = activeTo === cupKey;
            const isFaultCup = isLostFault && faultTarget === cupKey;
            const isHovered = hoveredVariable === cupKey;

            const cfg = CUP_PALETTE[cupIdx % CUP_PALETTE.length];
            const rawValText = hasValue
              ? typeof val === 'object'
                ? JSON.stringify(val)
                : String(val)
              : explainLanguage === 'bn'
              ? 'খালি'
              : 'empty';
            const displayValText =
              rawValText.length > 8 ? `${rawValText.slice(0, 7)}…` : rawValText;
            const valFontSize = !hasValue
              ? 12
              : displayValText.length <= 3
              ? 20
              : displayValText.length <= 5
              ? 15
              : 11;

            const displayLabel = cupKey.length > 10 ? `${cupKey.slice(0, 9)}…` : cupKey;
            const labelFontSize = displayLabel.length > 7 ? 10 : 12;

            return (
              <g key={cupKey} transform={`translate(${cx}, 96)`}>
                {(isSource || isTarget || isHovered || isFaultCup) && (
                  <motion.rect
                    x="-56"
                    y="-14"
                    width="112"
                    height="150"
                    rx="18"
                    fill="none"
                    stroke={
                      isFaultCup
                        ? '#FF6B7D'
                        : isSource
                        ? '#A3C1FF'
                        : isTarget
                        ? '#FFB26B'
                        : '#C6D8FF'
                    }
                    strokeWidth={isFaultCup || isHovered ? 2.5 : 2}
                    strokeDasharray={isTarget && !isFaultCup ? '6 4' : undefined}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.24 }}
                  />
                )}

                {/* Role Badge above cup */}
                {(isSource || isTarget || isFaultCup) && (
                  <g transform="translate(0, -26)">
                    <rect
                      x="-44"
                      y="-12"
                      width="88"
                      height="20"
                      rx="6"
                      fill={
                        isFaultCup
                          ? 'rgba(255, 107, 125, 0.22)'
                          : isSource
                          ? 'rgba(163, 193, 255, 0.2)'
                          : 'rgba(255, 178, 107, 0.2)'
                      }
                      stroke={isFaultCup ? '#FF6B7D' : isSource ? '#A3C1FF' : '#FFB26B'}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="2"
                      textAnchor="middle"
                      fill={isFaultCup ? '#FF6B7D' : isSource ? '#C6D8FF' : '#FFB26B'}
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="600"
                    >
                      {isFaultCup
                        ? 'OVERWRITTEN!'
                        : isSource
                        ? explainLanguage === 'bn'
                          ? 'উৎস (SOURCE)'
                          : 'SOURCE'
                        : explainLanguage === 'bn'
                        ? 'গন্তব্য (TARGET)'
                        : 'TARGET'}
                    </text>
                  </g>
                )}

                {/* Clipped Liquid + Value Inside Cup */}
                <g clipPath="url(#cup-interior-clip)">
                  <motion.g
                    initial={false}
                    animate={{
                      y: hasValue ? liquidTopY : cupHeight + 10,
                    }}
                    transition={
                      reduceMotion
                        ? { duration: 0.01 }
                        : { type: 'spring', stiffness: 180, damping: 22 }
                    }
                  >
                    <motion.path
                      d="M -90 0 Q -67 -6 -45 0 T 0 0 T 45 0 T 90 0 L 90 140 L -90 140 Z"
                      fill={isFaultCup ? '#FF6B7D' : `url(#${cfg.liquidGradId})`}
                      animate={
                        reduceMotion
                          ? { x: 0 }
                          : {
                              x: [-22, 22, -22],
                            }
                      }
                      transition={{
                        duration: 3.2,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />

                    {isTarget && hasValue && (
                      <motion.ellipse
                        cx="0"
                        cy="2"
                        rx="28"
                        ry="4"
                        fill="none"
                        stroke="#EEF3FF"
                        strokeWidth="1.8"
                        initial={{ scale: 0.3, opacity: 0.9 }}
                        animate={{ scale: 1.25, opacity: 0 }}
                        transition={{ duration: 0.75, repeat: Infinity }}
                      />
                    )}
                  </motion.g>

                  {/* Value readout safely clipped and scaled inside cup */}
                  <text
                    x="0"
                    y="72"
                    textAnchor="middle"
                    fill={hasValue ? '#EEF3FF' : 'rgba(163, 193, 255, 0.55)'}
                    fontSize={valFontSize}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="700"
                  >
                    {displayValText}
                  </text>
                </g>

                {/* Glass Cup Rim & Body Outline */}
                <path
                  d="M -45 0 L -36 112 Q -35 122 -24 122 L 24 122 Q 35 122 36 112 L 45 0"
                  fill="rgba(238, 243, 255, 0.05)"
                  stroke={isFaultCup ? '#FF6B7D' : isHovered ? '#A3C1FF' : 'rgba(198, 216, 255, 0.48)'}
                  strokeWidth={isFaultCup ? 2.5 : 2}
                  strokeLinecap="round"
                />
                <path
                  d="M -36 12 L -30 104"
                  stroke="rgba(255, 255, 255, 0.25)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Variable Name Tag Below Shelf (Wide enough for variable names) */}
                <g transform="translate(0, 148)">
                  <rect
                    x="-48"
                    y="-12"
                    width="96"
                    height="24"
                    rx="7"
                    fill="rgba(7, 10, 26, 0.85)"
                    stroke={cfg.color}
                    strokeWidth="1.2"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill="#EEF3FF"
                    fontSize={labelFontSize}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                  >
                    {displayLabel}
                  </text>
                </g>

                {/* LOST VALUE FAULT: Liquid Splash Droplets */}
                {isFaultCup && (
                  <g data-testid="fault-lost-value-splash">
                    {[
                      { dx: -52, dy: -24, r: 4.5 },
                      { dx: -64, dy: 12, r: 3.5 },
                      { dx: 52, dy: -20, r: 5 },
                      { dx: 64, dy: 16, r: 3.5 },
                    ].map((drop, dIdx) => (
                      <motion.circle
                        key={dIdx}
                        cx="0"
                        cy="20"
                        r={drop.r}
                        fill="#FF6B7D"
                        initial={{ x: 0, y: 0, opacity: 1 }}
                        animate={{
                          x: drop.dx,
                          y: drop.dy,
                          opacity: [1, 0.9, 0.2],
                        }}
                        transition={{
                          duration: 0.85,
                          repeat: reduceMotion ? 0 : Infinity,
                          repeatDelay: 0.4,
                        }}
                      />
                    ))}

                    <motion.g
                      initial={{ y: -8, opacity: 0 }}
                      animate={{ y: -44, opacity: 1 }}
                      transition={{ duration: 0.35 }}
                    >
                      <rect
                        x="-46"
                        y="-14"
                        width="92"
                        height="22"
                        rx="7"
                        fill="#FF6B7D"
                      />
                      <text
                        x="0"
                        y="1"
                        textAnchor="middle"
                        fill="#070A1A"
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="700"
                      >
                        -{step.fault?.lostValue ?? 'value'} lost!
                      </text>
                    </motion.g>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
