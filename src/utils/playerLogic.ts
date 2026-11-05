import { ExecutionTrace, TraceStep } from '../../shared/types';

export interface TextSegment {
  type: 'text' | 'code';
  content: string;
}

/**
 * Splits prose containing backtick-wrapped identifiers (like `temp` or `arr[j]`)
 * into typed segments so code words inside Bengali/English sentences render with
 * JetBrains Mono pills.
 */
export function parseInlineCodeSegments(input: string): TextSegment[] {
  if (!input) return [];
  const parts = input.split(/(`[^`]+`)/g);
  const result: TextSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      result.push({ type: 'code', content: part.slice(1, -1) });
    } else {
      result.push({ type: 'text', content: part });
    }
  }
  return result;
}

export function clampStepIndex(index: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  if (index < 0) return 0;
  if (index >= totalSteps) return totalSteps - 1;
  return index;
}

export function getNextStepIndex(currentIndex: number, totalSteps: number): number {
  return clampStepIndex(currentIndex + 1, totalSteps);
}

export function getPrevStepIndex(currentIndex: number, totalSteps: number): number {
  return clampStepIndex(currentIndex - 1, totalSteps);
}

export function findFirstStepForLine(steps: TraceStep[], line: number): number | null {
  const idx = steps.findIndex((s) => s.activeLine === line);
  return idx >= 0 ? idx : null;
}

export function getStepDurationMs(speed: number, baseMs = 1350): number {
  const safeSpeed = speed > 0 ? speed : 1;
  return Math.round(baseMs / safeSpeed);
}

export function getStepDotCategory(step: TraceStep): 'fault' | 'swap' | 'compare' | 'normal' {
  if (step.fault || step.action === 'halt') return 'fault';
  if (step.action === 'swap' || step.action === 'transfer') return 'swap';
  if (step.action === 'compare' || step.action === 'loop_check') return 'compare';
  return 'normal';
}

export function getFileNameForLanguage(language: ExecutionTrace['language']): string {
  switch (language) {
    case 'javascript':
      return 'main.js';
    case 'python':
      return 'main.py';
    case 'cpp':
      return 'main.cpp';
    case 'java':
      return 'Main.java';
  }
}
