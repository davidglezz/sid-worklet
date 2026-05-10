import { describe, expect, it, vi } from 'vite-plus/test';

// SIDNode extends AudioWorkletNode which does not exist in Node.js.
// Mock the module before any import that pulls it in transitively.
vi.mock('./sid-node.ts', () => ({
  SIDNode: class {
    on() {
      return () => {};
    }
    connect() {}
    disconnect() {}
    load() {}
    setPosition() {}
    setSubsong() {}
    addEventListener() {}
    removeEventListener() {}
  },
}));

import { LogEvent, PlayerErrorEvent, PositionEvent, SongInfoEvent } from './audio-player.ts';
import { formatTime, parseDuration, parseSongLine } from './utils.ts';

// ---------------------------------------------------------------------------
// Event classes
// ---------------------------------------------------------------------------

describe('PositionEvent', () => {
  it('has type "position"', () => {
    expect(new PositionEvent(0).type).toBe('position');
  });

  it('stores the value', () => {
    expect(new PositionEvent(42.5).value).toBe(42.5);
  });
});

describe('SongInfoEvent', () => {
  const info = {
    Name: 'Artist - Title',
    Info: '(c) 1991',
    Duration: 0,
    Subsong: 0,
    Subsongs: 1,
  };

  it('has type "songInfo"', () => {
    expect(new SongInfoEvent(info).type).toBe('songInfo');
  });

  it('stores the songInfo object', () => {
    expect(new SongInfoEvent(info).songInfo).toEqual(info);
  });
});

describe('LogEvent', () => {
  it('has type "log"', () => {
    expect(new LogEvent('info', 'hello').type).toBe('log');
  });

  it('stores severity and message', () => {
    const ev = new LogEvent('warn', 'something happened');
    expect(ev.severity).toBe('warn');
    expect(ev.message).toBe('something happened');
  });
});

describe('PlayerErrorEvent', () => {
  it('has type "error"', () => {
    expect(new PlayerErrorEvent(new Error('boom')).type).toBe('error');
  });

  it('stores the error object', () => {
    const err = new Error('network failure');
    expect(new PlayerErrorEvent(err).error).toBe(err);
  });
});

// ---------------------------------------------------------------------------
// parseDuration
// ---------------------------------------------------------------------------

describe('parseDuration', () => {
  it('returns 0 for undefined', () => {
    expect(parseDuration(undefined)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseDuration('')).toBe(0);
  });

  it('parses "0:00" as 0', () => {
    expect(parseDuration('0:00')).toBe(0);
  });

  it('parses "1:30" as 90', () => {
    expect(parseDuration('1:30')).toBe(90);
  });

  it('parses "10:05" as 605', () => {
    expect(parseDuration('10:05')).toBe(605);
  });

  it('returns 0 for malformed input', () => {
    expect(parseDuration('abc')).toBe(0);
    expect(parseDuration('1:xx')).toBe(0);
  });

  it('trims whitespace before parsing', () => {
    expect(parseDuration('  2:00  ')).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe('formatTime', () => {
  it('formats 0 as "00:00"', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats 90 as "01:30"', () => {
    expect(formatTime(90)).toBe('01:30');
  });

  it('formats 605 as "10:05"', () => {
    expect(formatTime(605)).toBe('10:05');
  });

  it('clamps negative values to "00:00"', () => {
    expect(formatTime(-10)).toBe('00:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(1.9)).toBe('00:01');
  });

  it('pads single-digit minutes and seconds', () => {
    expect(formatTime(65)).toBe('01:05');
  });
});

// ---------------------------------------------------------------------------
// parseSongLine
// ---------------------------------------------------------------------------

describe('parseSongLine', () => {
  it('returns null for an empty line', () => {
    expect(parseSongLine('')).toBeNull();
    expect(parseSongLine('   ')).toBeNull();
  });

  it('parses a line with path and single duration', () => {
    const result = parseSongLine('/Hubbard_Rob/Delta.sid\t3:45');
    expect(result).toEqual({
      relativeUrl: '/Hubbard_Rob/Delta.sid',
      path: '/Hubbard_Rob',
      name: 'Delta',
      durations: ['3:45'],
    });
  });

  it('parses a line with multiple subsong durations', () => {
    const result = parseSongLine('/Daglish_Ben/Thing.sid\t1:00\t2:30\t0:45');
    expect(result?.durations).toEqual(['1:00', '2:30', '0:45']);
  });

  it('handles a filename with no parent directory', () => {
    const result = parseSongLine('song.sid\t1:00');
    expect(result?.path).toBe('');
    expect(result?.name).toBe('song');
  });

  it('strips the file extension from the name', () => {
    const result = parseSongLine('/A/My_Song.sid\t0:30');
    expect(result?.name).toBe('My_Song');
  });

  it('handles a filename with no extension', () => {
    const result = parseSongLine('/A/NoExt\t1:00');
    expect(result?.name).toBe('NoExt');
  });
});
