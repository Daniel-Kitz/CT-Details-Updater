import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  effectiveVerificationDate,
  interpolateTemplate,
  isPersonOverdue,
  isValidRange,
  normalizeSongName,
  rangeForMonths,
  songMatchesQuery,
  type PersonRecord,
} from './index.ts';

const now = new Date('2026-08-17T12:00:00Z');

function person(overrides: Partial<PersonRecord> = {}): PersonRecord {
  return {
    id: 1,
    firstName: 'Maria',
    lastName: 'Muster',
    email: 'maria@example.org',
    ...overrides,
  };
}

test('uses explicit verification date before edit metadata', () => {
  const date = effectiveVerificationDate(
    person({
      dataVerifiedAt: '2026-01-02',
      lastEditedDate: '2026-08-01T00:00:00Z',
    }),
  );
  assert.equal(date?.toISOString().slice(0, 10), '2026-01-02');
});

test('falls back to the last edited date', () => {
  const date = effectiveVerificationDate(
    person({ lastEditedDate: '2026-07-01T00:00:00Z' }),
  );
  assert.equal(date?.toISOString(), '2026-07-01T00:00:00.000Z');
});

test('marks a person older than the interval overdue', () => {
  assert.equal(
    isPersonOverdue(
      person({ dataVerifiedAt: '2026-01-01' }),
      DEFAULT_SETTINGS,
      now,
    ),
    true,
  );
});

test('keeps a recently verified person current', () => {
  assert.equal(
    isPersonOverdue(
      person({ dataVerifiedAt: '2026-07-01' }),
      DEFAULT_SETTINGS,
      now,
    ),
    false,
  );
});

test('applies status and campus scopes', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    statusIds: [2],
    campusIds: [5],
  };
  assert.equal(
    isPersonOverdue(person({ statusId: 2, campusId: 5 }), settings, now),
    true,
  );
  assert.equal(
    isPersonOverdue(person({ statusId: 3, campusId: 5 }), settings, now),
    false,
  );
});

test('interpolates known placeholders and preserves unknown ones', () => {
  assert.equal(
    interpolateTemplate('Hallo {{firstName}} – {{unknown}}', {
      firstName: 'Maria',
    }),
    'Hallo Maria – {{unknown}}',
  );
});

test('normalizes song titles for matching', () => {
  assert.equal(normalizeSongName('Großer Gott, wir loben Dich!'), 'grosser gott wir loben dich');
  assert.equal(normalizeSongName('  10.000 Reasons  '), '10 000 reasons');
});

test('matches partial and diacritic-insensitive queries', () => {
  assert.equal(songMatchesQuery('Herr, deine Liebe', 'liebe'), true);
  assert.equal(songMatchesQuery('Herr, deine Liebe', 'LIEBE!!'), true);
  assert.equal(songMatchesQuery('Herr, deine Liebe', 'Grösster'), false);
  assert.equal(songMatchesQuery('Herr, deine Liebe', ''), false);
});

test('builds a month range ending today', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const range = rangeForMonths(3, now);
  assert.equal(range.to, '2026-08-17');
  assert.equal(range.from, '2026-05-17');
});

test('rejects invalid or oversized ranges', () => {
  assert.equal(
    isValidRange({ from: '2026-05-01', to: '2026-08-01' }, 24),
    true,
  );
  assert.equal(isValidRange({ from: '2026-08-01', to: '2026-05-01' }, 24), false);
  assert.equal(isValidRange({ from: 'nope', to: '2026-05-01' }, 24), false);
  assert.equal(
    isValidRange({ from: '2020-01-01', to: '2026-01-01' }, 24),
    false,
  );
});
