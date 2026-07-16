/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the newly-designed UI entry points for `select_strategy` and
// `adjust_confidence` (server.js) — both macros were functional and
// correctly-shaped but had no button anywhere in page.tsx before this pass.
// Covers: the strategy-suggestion flow, the confidence-adjustment flow, and
// honest loading/error states for both (no fabricated results on failure).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ReasoningToolkit } from './ReasoningToolkit';

describe('ReasoningToolkit', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  describe('Strategy Advisor (select_strategy)', () => {
    it('calls select_strategy with the typed problem and renders the suggested strategy + alternatives', async () => {
      lensRun.mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            strategy: { name: 'abductive', description: 'Find the best explanation for observations' },
            alternatives: [
              { name: 'empirical', description: 'Gather evidence through observation' },
            ],
          },
          error: null,
        },
      });

      render(<ReasoningToolkit />);

      fireEvent.change(screen.getByLabelText("What's your problem?"), {
        target: { value: 'Why does this keep failing?' },
      });
      fireEvent.click(screen.getByText('Suggest a reasoning strategy'));

      await waitFor(() =>
        expect(lensRun).toHaveBeenCalledWith('metacognition', 'select_strategy', {
          problem: 'Why does this keep failing?',
        }),
      );

      expect(await screen.findByText('abductive')).toBeInTheDocument();
      expect(screen.getByText('Find the best explanation for observations')).toBeInTheDocument();
      expect(screen.getByText('empirical')).toBeInTheDocument();
    });

    it('disables the button until a problem is typed and never calls the macro with empty input', () => {
      render(<ReasoningToolkit />);
      const button = screen.getByText('Suggest a reasoning strategy');
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(lensRun).not.toHaveBeenCalled();
    });

    it('shows a loading state while the strategy call is in flight', async () => {
      let resolveCall: (v: unknown) => void = () => {};
      lensRun.mockImplementationOnce(
        () => new Promise((resolve) => { resolveCall = resolve; }),
      );

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText("What's your problem?"), {
        target: { value: 'Should I trust this pattern?' },
      });
      fireEvent.click(screen.getByText('Suggest a reasoning strategy'));

      expect(await screen.findByText('Analyzing...')).toBeInTheDocument();

      resolveCall({
        data: {
          ok: true,
          result: { strategy: { name: 'inductive', description: 'Generalize from specific observations' }, alternatives: [] },
          error: null,
        },
      });

      await waitFor(() => expect(screen.getByText('inductive')).toBeInTheDocument());
    });

    it('surfaces an honest error and renders no fabricated strategy on failure', async () => {
      lensRun.mockResolvedValueOnce({
        data: { ok: false, result: null, error: 'problem description required' },
      });

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText("What's your problem?"), {
        target: { value: 'x' },
      });
      fireEvent.click(screen.getByText('Suggest a reasoning strategy'));

      expect(await screen.findByText('problem description required')).toBeInTheDocument();
      // No strategy badge/description rendered.
      expect(screen.queryByText('deductive')).not.toBeInTheDocument();
      expect(screen.queryByText('Also consider:')).not.toBeInTheDocument();
    });

    it('surfaces a network-rejection error honestly', async () => {
      lensRun.mockRejectedValueOnce(new Error('network down'));

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText("What's your problem?"), {
        target: { value: 'Will this scale?' },
      });
      fireEvent.click(screen.getByText('Suggest a reasoning strategy'));

      expect(await screen.findByText('network down')).toBeInTheDocument();
    });
  });

  describe('Confidence Adjuster (adjust_confidence)', () => {
    it('calls adjust_confidence with the domain + slider value and renders original/adjusted/explanation', async () => {
      lensRun.mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            original: 0.7,
            adjusted: 0.49,
            factor: 0.7,
            domain: 'reasoning',
            explanation: 'Confidence reduced due to historical weakness in "reasoning"',
          },
          error: null,
        },
      });

      render(<ReasoningToolkit />);

      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'reasoning' } });
      fireEvent.change(screen.getByLabelText('Starting confidence'), { target: { value: '0.7' } });
      fireEvent.click(screen.getByText('Get domain-adjusted estimate'));

      await waitFor(() =>
        expect(lensRun).toHaveBeenCalledWith('metacognition', 'adjust_confidence', {
          domain: 'reasoning',
          confidence: 0.7,
        }),
      );

      expect(await screen.findByText('70%')).toBeInTheDocument();
      expect(screen.getByText('49%')).toBeInTheDocument();
      expect(
        screen.getByText('Confidence reduced due to historical weakness in "reasoning"'),
      ).toBeInTheDocument();
    });

    it('renders a boosted (green, up-arrow) result when factor > 1', async () => {
      lensRun.mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            original: 0.5,
            adjusted: 0.6,
            factor: 1.2,
            domain: 'memory',
            explanation: 'Confidence boosted due to historical strength in "memory"',
          },
          error: null,
        },
      });

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'memory' } });
      fireEvent.click(screen.getByText('Get domain-adjusted estimate'));

      expect(await screen.findByLabelText('boosted')).toBeInTheDocument();
      expect(
        screen.getByText('Confidence boosted due to historical strength in "memory"'),
      ).toBeInTheDocument();
    });

    it('disables the button until a domain is typed and never calls the macro with empty input', () => {
      render(<ReasoningToolkit />);
      const button = screen.getByText('Get domain-adjusted estimate');
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(lensRun).not.toHaveBeenCalled();
    });

    it('shows a loading state while the confidence call is in flight', async () => {
      let resolveCall: (v: unknown) => void = () => {};
      lensRun.mockImplementationOnce(
        () => new Promise((resolve) => { resolveCall = resolve; }),
      );

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'engineering' } });
      fireEvent.click(screen.getByText('Get domain-adjusted estimate'));

      expect(await screen.findByText('Adjusting...')).toBeInTheDocument();

      resolveCall({
        data: {
          ok: true,
          result: { original: 0.7, adjusted: 0.7, factor: 1.0, domain: 'engineering', explanation: 'No adjustment applied' },
          error: null,
        },
      });

      await waitFor(() => expect(screen.getByText('No adjustment applied')).toBeInTheDocument());
    });

    it('surfaces an honest error and renders no fabricated estimate on failure', async () => {
      lensRun.mockResolvedValueOnce({
        data: { ok: false, result: null, error: 'handler_error' },
      });

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'reasoning' } });
      fireEvent.click(screen.getByText('Get domain-adjusted estimate'));

      expect(await screen.findByText('handler_error')).toBeInTheDocument();
      expect(screen.queryByText('No adjustment applied')).not.toBeInTheDocument();
    });

    it('surfaces a network-rejection error honestly', async () => {
      lensRun.mockRejectedValueOnce(new Error('network down'));

      render(<ReasoningToolkit />);
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'reasoning' } });
      fireEvent.click(screen.getByText('Get domain-adjusted estimate'));

      expect(await screen.findByText('network down')).toBeInTheDocument();
    });
  });
});
