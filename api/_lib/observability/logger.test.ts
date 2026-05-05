import { describe, it, expect, beforeEach, vi } from 'vitest';
import { log, logger } from './logger';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
  });

  describe('console fallback', () => {
    it('logs to console.log for info level', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await log('info', 'test message', { source: 'test' });
      expect(spy).toHaveBeenCalledOnce();
      const callArg = JSON.parse(spy.mock.calls[0][0] as string);
      expect(callArg.level).toBe('info');
      expect(callArg.message).toBe('test message');
      expect(callArg.source).toBe('test');
    });

    it('logs to console.error for error level', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await log('error', 'oops', { source: 'test' });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('logs to console.warn for warn level', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await log('warn', 'careful', { source: 'test' });
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe('event shape', () => {
    it('includes _time as ISO timestamp', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await log('info', 'msg', { source: 'test' });
      const event = JSON.parse(spy.mock.calls[0][0] as string);
      expect(event._time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('preserves arbitrary context fields', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await log('info', 'msg', {
        source: 'test',
        dealId: 26717,
        customField: 'foo',
      });
      const event = JSON.parse(spy.mock.calls[0][0] as string);
      expect(event.dealId).toBe(26717);
      expect(event.customField).toBe('foo');
      expect(event.source).toBe('test');
    });

    it('includes environment when VERCEL_ENV is set', async () => {
      process.env.VERCEL_ENV = 'production';
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await log('info', 'msg', { source: 'test' });
      const event = JSON.parse(spy.mock.calls[0][0] as string);
      expect(event.environment).toBe('production');
      delete process.env.VERCEL_ENV;
    });
  });

  describe('logger convenience', () => {
    it('logger.info delegates to log with info level', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await logger.info('hello', { source: 'test' });
      const event = JSON.parse(spy.mock.calls[0][0] as string);
      expect(event.level).toBe('info');
    });

    it('logger.error delegates to log with error level', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logger.error('boom', { source: 'test' });
      const event = JSON.parse(spy.mock.calls[0][0] as string);
      expect(event.level).toBe('error');
    });
  });

  describe('Axiom integration (no token)', () => {
    it('returns null client when AXIOM_TOKEN missing — does not throw', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // Should not throw
      await expect(log('info', 'msg', { source: 'test' })).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledOnce();
    });
  });
});
