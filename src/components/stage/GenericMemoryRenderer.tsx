import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ExecutionTrace,
  ExplainLanguage,
  TraceStep,
  VariableSnapshot,
} from '../../../shared/types';
import {
  extractDeclaredVariableTypes,
  resolveAccurateVariableType,
} from '../../../shared/declaredTypeHelper';
import { Link2, GitCompare, ArrowRight } from 'lucide-react';

interface GenericMemoryRendererProps {
  trace: ExecutionTrace;
  step: TraceStep | undefined;
  explainLanguage: ExplainLanguage;
  hoveredVariable: string | null;
  reduceMotion: boolean;
}

interface ConnectorLink {
  id: string;
  fromName: string;
  toName: string;
  label: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const GROUP_COLORS = ['#34D399', '#60A5FA', '#A78BFA', '#FBBF24'];

export const GenericMemoryRenderer: React.FC<GenericMemoryRendererProps> = ({
  trace,
  step,
  explainLanguage,
  hoveredVariable,
  reduceMotion,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [connectors, setConnectors] = useState<ConnectorLink[]>([]);

  const isCompileErrorState = trace.verdict.status === 'compile_error' || !step;
  const changedMap = new Map((step?.changes || []).map((c) => [c.name, c]));
  const declaredTypesMap = extractDeclaredVariableTypes(
    (trace.steps || []).map((s) => s.codeSnippet || '').join('\n'),
    trace.language
  );

  // Normalize variable snapshots with true declared language types & memory references
  const snapshots: VariableSnapshot[] = isCompileErrorState
    ? []
    : step.variableSnapshots && step.variableSnapshots.length > 0
    ? step.variableSnapshots.map((snap) => ({
        ...snap,
        type: resolveAccurateVariableType(
          snap.type,
          snap.value,
          trace.language,
          snap.name,
          declaredTypesMap
        ),
      }))
    : Object.entries(step.variables || {}).map(([name, val]) => ({
        name,
        type: resolveAccurateVariableType(
          undefined,
          val,
          trace.language,
          name,
          declaredTypesMap
        ),
        value: val,
        memoryAddress: null,
        referenceId: null,
        pointsTo: null,
        changed: changedMap.has(name),
      }));

  // Group variables by shared referenceId (2+ variables sharing same object/cache)
  const refGroups = new Map<string, string[]>();
  for (const snap of snapshots) {
    const refKey = snap.referenceId || snap.memoryAddress;
    if (refKey) {
      const list = refGroups.get(refKey) || [];
      list.push(snap.name);
      refGroups.set(refKey, list);
    }
  }

  const sharedRefColors = new Map<string, string>();
  const sharedPools: { refId: string; vars: string[]; color: string }[] = [];
  let colorIdx = 0;
  for (const [refId, varNames] of refGroups.entries()) {
    if (varNames.length >= 2) {
      const color = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
      sharedRefColors.set(refId, color);
      sharedPools.push({ refId, vars: varNames, color });
      colorIdx++;
    }
  }

  // Pointer edges (pointsTo -> target variable)
  const pointerEdges: { from: string; to: string; label: string }[] = [];
  const snapNames = new Set(snapshots.map((s) => s.name));
  for (const snap of snapshots) {
    if (snap.pointsTo && snapNames.has(snap.pointsTo) && snap.pointsTo !== snap.name) {
      pointerEdges.push({
        from: snap.name,
        to: snap.pointsTo,
        label: `${snap.name} → ${snap.pointsTo}`,
      });
    }
  }

  // Compute SVG connector coordinates between shared-reference or pointer-linked cards
  useLayoutEffect(() => {
    if (isCompileErrorState) {
      setConnectors([]);
      return;
    }
    const computeLinks = () => {
      const container = containerRef.current;
      if (!container) {
        setConnectors([]);
        return;
      }
      const cRect = container.getBoundingClientRect();
      const nextLinks: ConnectorLink[] = [];

      // Shared referenceId links (pairwise adjacent inside each shared pool)
      for (const pool of sharedPools) {
        for (let i = 0; i < pool.vars.length - 1; i++) {
          const fromName = pool.vars[i];
          const toName = pool.vars[i + 1];
          const fromEl = cardRefs.current[fromName];
          const toEl = cardRefs.current[toName];
          if (!fromEl || !toEl) continue;
          const r1 = fromEl.getBoundingClientRect();
          const r2 = toEl.getBoundingClientRect();
          nextLinks.push({
            id: `ref-${pool.refId}-${fromName}-${toName}`,
            fromName,
            toName,
            label: pool.refId,
            color: pool.color,
            x1: r1.left - cRect.left + r1.width / 2,
            y1: r1.top - cRect.top + 6,
            x2: r2.left - cRect.left + r2.width / 2,
            y2: r2.top - cRect.top + 6,
          });
        }
      }

      // Pointer edges
      for (const edge of pointerEdges) {
        const fromEl = cardRefs.current[edge.from];
        const toEl = cardRefs.current[edge.to];
        if (!fromEl || !toEl) continue;
        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();
        nextLinks.push({
          id: `ptr-${edge.from}-${edge.to}`,
          fromName: edge.from,
          toName: edge.to,
          label: edge.label,
          color: '#60A5FA',
          x1: r1.left - cRect.left + r1.width / 2,
          y1: r1.bottom - cRect.top - 4,
          x2: r2.left - cRect.left + r2.width / 2,
          y2: r2.bottom - cRect.top - 4,
        });
      }

      setConnectors(nextLinks);
    };

    computeLinks();
    const ro =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(computeLinks)
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', computeLinks);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', computeLinks);
    };
  }, [isCompileErrorState, step?.stepIndex, snapshots.length, sharedPools.length, pointerEdges.length]);

  // Handle Compile / Syntax Error where steps === []
  if (isCompileErrorState) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full min-h-[220px] p-4 sm:p-6 text-center select-none overflow-hidden"
        data-testid="renderer-compile-error"
      >
        <h3
          lang={explainLanguage}
          className="text-base font-bold text-[var(--text-danger)] mb-1.5"
        >
          {explainLanguage === 'bn'
            ? 'কম্পাইল বা সিনট্যাক্স ত্রুটি — অ্যানিমেশন তৈরি করা হয়নি'
            : 'Compile / Syntax Error — No Animation Generated'}
        </h3>
        <p
          lang={explainLanguage}
          className="text-sm text-[var(--text-primary)] max-w-md mb-3 break-words"
        >
          {trace.errorDetails?.message || trace.verdict.message}
        </p>
        {trace.errorDetails?.line && (
          <span className="font-mono text-xs px-3 py-1 rounded-md bg-[#EF4444]/15 border border-[#EF4444]/40 text-[var(--text-danger)]">
            Line {trace.errorDetails.line}
          </span>
        )}
      </div>
    );
  }

  const comparison = step.visualCue?.comparison || null;
  const compareSet = new Set<string>([
    ...(step.visualCue?.compareVars || []),
    ...(comparison?.leftVar ? [comparison.leftVar] : []),
    ...(comparison?.rightVar ? [comparison.rightVar] : []),
  ]);
  const highlightSet = new Set<string>(step.visualCue?.highlightVars || []);
  const pointersMap = step.structure?.pointers || {};

  const badgeLabel = step.actionType || step.action.toUpperCase();

  return (
    <div
      className="relative flex flex-col justify-between w-full h-full min-h-[240px] select-none overflow-hidden"
      data-testid="renderer-generic-memory"
    >
      {/* Top Action & Mode Strip (Unboxed hairline divider) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-subtle)] text-xs">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <span className="font-medium" lang={explainLanguage}>
            {explainLanguage === 'bn'
              ? 'স্ট্যাক ও হিপ মেমোরি (ভেরিয়েবল ও ঠিকানা)'
              : 'Stack & Heap Memory (Variables & Addresses)'}
          </span>
          {sharedPools.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#10B981]/10 text-[var(--text-success)] font-mono text-[11px] font-semibold">
              <Link2 className="w-3 h-3" />
              {explainLanguage === 'bn' ? 'একই মেমোরি শেয়ার করছে' : 'Shared Reference'}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-gutter)] border border-[var(--border-subtle)] text-[var(--text-accent)] font-semibold">
          {badgeLabel} · Ln {step.activeLine}
        </span>
      </div>

      {/* Active Comparison Pill (COMPARISON / CONDITION steps) */}
      <AnimatePresence mode="wait">
        {comparison && (
          <motion.div
            key={`cmp-${step.stepIndex}-${comparison.leftLabel}-${comparison.rightLabel}`}
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
            className={`mt-3 px-3.5 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-xs ${
              comparison.result
                ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[var(--text-success)]'
                : 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[var(--text-danger)]'
            }`}
            data-testid="active-comparison-pill"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono font-semibold">
              <GitCompare className="w-3.5 h-3.5 shrink-0" />
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-primary)]">
                {comparison.leftLabel}
              </span>
              <span className="text-[var(--text-accent)] font-bold">{comparison.operator}</span>
              <span className="px-2 py-0.5 rounded bg-[var(--bg-gutter)] text-[var(--text-primary)]">
                {comparison.rightLabel}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  comparison.result
                    ? 'bg-[#10B981]/20 text-[#34D399]'
                    : 'bg-[#EF4444]/20 text-[#F87171]'
                }`}
              >
                {comparison.result ? 'TRUE' : 'FALSE'}
              </span>
            </div>
            {comparison.reason && (
              <span
                lang={explainLanguage}
                className="text-[11px] text-[var(--text-secondary)] font-normal"
              >
                {comparison.reason}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Variable Nodes Stage + Glowing SVG Reference Connectors */}
      <div
        ref={containerRef}
        className="relative flex flex-wrap items-stretch justify-center gap-3.5 sm:gap-4 my-5 pt-4 pb-2 w-full"
      >
        {/* SVG Overlay for Shared Reference & Pointer Links */}
        {connectors.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 w-full h-full overflow-visible z-10"
            aria-hidden="true"
          >
            <defs>
              <filter id="ref-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker
                id="ptr-arrowhead"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#60A5FA" />
              </marker>
            </defs>
            {connectors.map((link) => {
              const midX = (link.x1 + link.x2) / 2;
              const isPointer = link.id.startsWith('ptr-');
              const arcY = isPointer
                ? Math.max(link.y1, link.y2) + 26
                : Math.min(link.y1, link.y2) - 24;
              const pathD = `M ${link.x1} ${link.y1} Q ${midX} ${arcY} ${link.x2} ${link.y2}`;
              return (
                <g key={link.id}>
                  <motion.path
                    d={pathD}
                    fill="none"
                    stroke={link.color}
                    strokeWidth="2"
                    strokeDasharray={isPointer ? '4 3' : undefined}
                    markerEnd={isPointer ? 'url(#ptr-arrowhead)' : undefined}
                    filter="url(#ref-glow)"
                    initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.9 }}
                    transition={{ duration: reduceMotion ? 0.01 : 0.4 }}
                  />
                  <circle cx={link.x1} cy={link.y1} r="3.5" fill={link.color} />
                  {!isPointer && <circle cx={link.x2} cy={link.y2} r="3.5" fill={link.color} />}
                </g>
              );
            })}
          </svg>
        )}

        {snapshots.length === 0 ? (
          <div className="px-4 py-3 rounded-xl bg-[var(--bg-gutter)]/60 border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] font-mono text-center">
            {explainLanguage === 'bn'
              ? 'এই ধাপে মেমোরিতে কোনো ভ্যারিয়েবল এখনো তৈরি হয়নি'
              : 'No variables allocated in memory at this step yet'}
          </div>
        ) : (
          snapshots.map((snap) => {
            const change = changedMap.get(snap.name);
            const isChanged = Boolean(change || snap.changed);
            const isCompared = compareSet.has(snap.name);
            const isHighlighted = highlightSet.has(snap.name);
            const isHovered = hoveredVariable === snap.name;
            const refKey = snap.referenceId || snap.memoryAddress || '';
            const sharedColor = refKey ? sharedRefColors.get(refKey) : undefined;
            const isArrayVal = Array.isArray(snap.value);
            const formattedScalar =
              typeof snap.value === 'object' && snap.value !== null
                ? JSON.stringify(snap.value)
                : String(snap.value);

            return (
              <motion.div
                key={snap.name}
                ref={(el) => {
                  cardRefs.current[snap.name] = el;
                }}
                layout={!reduceMotion}
                layoutId={reduceMotion ? undefined : `mem-var-${snap.name}`}
                initial={reduceMotion ? false : { scale: 0.94, y: 6, opacity: 0 }}
                animate={{
                  scale: isCompared ? 1.03 : isChanged ? [1.03, 1] : 1,
                  y: isCompared ? -3 : 0,
                  opacity: 1,
                }}
                transition={
                  reduceMotion
                    ? { duration: 0.01 }
                    : { type: 'spring', stiffness: 280, damping: 24 }
                }
                className={`relative min-w-[148px] max-w-full sm:max-w-[260px] flex-1 p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 overflow-hidden transition-colors bg-[var(--bg-panel-raised)] ${
                  isCompared
                    ? comparison?.result === false
                      ? 'border-[#EF4444] ring-1 ring-[#EF4444]/40'
                      : 'border-[#34D399] ring-1 ring-[#34D399]/40'
                    : isChanged
                    ? 'border-[#10B981]'
                    : sharedColor
                    ? 'border-[#3B82F6]/70'
                    : isHighlighted || isHovered
                    ? 'border-[var(--border-active)]'
                    : 'border-[var(--border-subtle)]'
                }`}
                style={
                  sharedColor && !isCompared
                    ? { borderColor: sharedColor }
                    : undefined
                }
                data-testid={`memory-var-${snap.name}`}
              >
                {/* Header: Name + Language Type Badge + Status Pill */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="font-mono text-xs font-bold text-[var(--text-primary)] truncate"
                      title={snap.name}
                    >
                      {snap.name}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--code-pill-bg)] text-[var(--code-pill-text)] font-semibold shrink-0">
                      {snap.type}
                    </span>
                  </div>

                  {isCompared ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3B82F6]/20 text-[var(--text-accent)] font-bold shrink-0">
                      {explainLanguage === 'bn' ? 'তুলনা' : 'CMP'}
                    </span>
                  ) : isChanged ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#10B981]/20 text-[var(--text-success)] font-bold shrink-0">
                      {explainLanguage === 'bn' ? 'পরিবর্তিত' : 'Changed'}
                    </span>
                  ) : null}
                </div>

                {/* Value Readout */}
                {isArrayVal ? (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 py-1 w-full">
                    {(snap.value as unknown[]).map((item, idx) => {
                      const activePtrs = Object.entries(pointersMap)
                        .filter(([, pIdx]) => pIdx === idx)
                        .map(([pName]) => pName);
                      return (
                        <div
                          key={idx}
                          className={`px-2 py-1 rounded-lg bg-[var(--bg-gutter)] border font-mono text-xs font-bold text-[var(--text-primary)] flex flex-col items-center min-w-[2.2rem] ${
                            activePtrs.length > 0
                              ? 'border-[var(--border-active)]'
                              : 'border-[var(--border-subtle)]'
                          }`}
                        >
                          <span className="break-all text-center">{String(item)}</span>
                          <span className="text-[9px] text-[var(--text-muted)] font-normal">
                            [{idx}]
                            {activePtrs.length > 0 ? ` · ${activePtrs.join(',')}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={`font-mono font-bold text-[var(--text-primary)] py-0.5 break-words text-center w-full ${
                      formattedScalar.length > 16
                        ? 'text-xs'
                        : formattedScalar.length > 9
                        ? 'text-base'
                        : 'text-xl'
                    }`}
                  >
                    {formattedScalar}
                  </div>
                )}

                  {/* Memory Address / Reference ID & Pointer Target */}
                {(refKey || snap.pointsTo) && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono">
                    {refKey && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-gutter)] border border-[var(--border-subtle)] truncate max-w-full"
                        style={
                          sharedColor
                            ? { color: sharedColor, borderColor: `${sharedColor}66` }
                            : { color: 'var(--text-secondary)' }
                        }
                        title={
                          sharedColor
                            ? explainLanguage === 'bn'
                              ? `একই মেমোরি ঠিকানা শেয়ার করছে: ${refKey}`
                              : `Sharing same memory block: ${refKey}`
                            : refKey
                        }
                      >
                        {sharedColor && <Link2 className="w-2.5 h-2.5 shrink-0" />}
                        {refKey}
                      </span>
                    )}
                    {snap.pointsTo && (
                      <span className="px-1.5 py-0.5 rounded bg-[#3B82F6]/15 text-[var(--text-accent)] font-semibold">
                        → {snap.pointsTo}
                      </span>
                    )}
                  </div>
                )}

                {/* Mutation Delta: oldValue -> newValue */}
                {change && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)] pt-1.5 border-t border-[var(--border-subtle)] w-full break-all text-center">
                    <span className="opacity-75">
                      {change.from === null || change.from === undefined
                        ? '∅'
                        : typeof change.from === 'object'
                        ? JSON.stringify(change.from)
                        : String(change.from)}
                    </span>
                    <span className="text-[var(--text-accent)] font-bold">→</span>
                    <span className="text-[var(--text-success)] font-bold">
                      {typeof change.to === 'object' ? JSON.stringify(change.to) : String(change.to)}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Shared Heap / Cache Pool Strip (Unboxed horizontal bar) */}
      {sharedPools.length > 0 && (
        <div
          className="pt-2.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2 text-xs font-mono"
          data-testid="shared-reference-strip"
        >
          <span className="text-[var(--text-muted)] font-semibold">
            {explainLanguage === 'bn' ? 'শেয়ার্ড হিপ/ক্যাশ:' : 'Shared Heap / Cache:'}
          </span>
          {sharedPools.map((pool) => (
            <span
              key={pool.refId}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--bg-gutter)] border"
              style={{ borderColor: `${pool.color}66`, color: pool.color }}
            >
              <Link2 className="w-3 h-3" />
              <span>{pool.refId}</span>
              <span className="text-[var(--text-secondary)]">← {pool.vars.join(', ')}</span>
            </span>
          ))}
        </div>
      )}

      {/* Step Output Readout if stdout was produced by this line */}
      {step.stdout && (
        <div className="mt-2.5 pt-2.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <span className="text-[var(--text-success)] font-semibold shrink-0">
            {explainLanguage === 'bn' ? 'এই ধাপের আউটপুট (stdout):' : 'Step stdout:'}
          </span>
          <span className="text-[var(--text-primary)] font-bold break-all">
            {step.stdout.replace(/\n/g, ' ↵ ')}
          </span>
        </div>
      )}
    </div>
  );
};
