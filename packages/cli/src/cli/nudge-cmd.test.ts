import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { noteShownCommand, noteSignalCommand } from './nudge-cmd.js';
import { readNudgeEvents } from '../utils/nudge-events.js';

async function currentRootDir(): Promise<string> {
  return String((await import('./project-root.js')).resolveProjectRoot());
}

describe('nudge-cmd', () => {
  let home: string;
  let originalHome: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const session = 'nudge-cmd-test-session';

  beforeEach(async () => {
    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-cmd-'));
    process.env.LIEN_HOME = home;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(home, { recursive: true, force: true });
  });

  describe('noteShownCommand', () => {
    it('records a shown event with file, always exiting 0', async () => {
      await noteShownCommand({ session, nudge: 'blast', file: 'src/foo.ts' });

      const events = await readNudgeEvents(await currentRootDir());
      expect(events).toEqual([
        expect.objectContaining({
          kind: 'shown',
          nudge: 'blast',
          file: 'src/foo.ts',
          sessionId: session,
        }),
      ]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('records a file-less shown (test-verify)', async () => {
      await noteShownCommand({ session, nudge: 'test-verify' });
      const [e] = await readNudgeEvents(await currentRootDir());
      expect(e).toMatchObject({ kind: 'shown', nudge: 'test-verify' });
      expect('file' in e).toBe(false);
    });

    it('is a fail-open no-op on an unknown nudge name', async () => {
      await noteShownCommand({ session, nudge: 'delta' });
      expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op when --session is missing', async () => {
      await noteShownCommand({ nudge: 'annotate' });
      expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op when --nudge is missing', async () => {
      await noteShownCommand({ session });
      expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
    });
  });

  describe('noteSignalCommand', () => {
    it('records a signal event with file/symbol', async () => {
      await noteSignalCommand({
        session,
        signal: 'get_dependents',
        file: 'src/foo.ts',
        symbol: 'doThing',
      });
      const [e] = await readNudgeEvents(await currentRootDir());
      expect(e).toMatchObject({
        kind: 'signal',
        signal: 'get_dependents',
        file: 'src/foo.ts',
        symbol: 'doThing',
      });
    });

    it('is a fail-open no-op on an unknown signal name', async () => {
      await noteSignalCommand({ session, signal: 'search_code' });
      expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op when --session is missing', async () => {
      await noteSignalCommand({ signal: 'test_run' });
      expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
    });

    it('honors the LIEN_NUDGE_EVENTS=off kill switch', async () => {
      const prev = process.env.LIEN_NUDGE_EVENTS;
      process.env.LIEN_NUDGE_EVENTS = 'off';
      try {
        await noteSignalCommand({ session, signal: 'test_run' });
        expect(await readNudgeEvents(await currentRootDir())).toEqual([]);
      } finally {
        if (prev === undefined) delete process.env.LIEN_NUDGE_EVENTS;
        else process.env.LIEN_NUDGE_EVENTS = prev;
      }
    });
  });
});
