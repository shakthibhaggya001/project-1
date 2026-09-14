import React from 'react';

/**
 * Some AI-extracted questions embed their own table directly in the
 * question text (e.g. matching-pairs questions: "Match column A to column
 * B"), rather than as a group-level shared context. The extraction model
 * sometimes flattens the table onto one line using "||" between rows
 * instead of real line breaks, which would otherwise render as a wall of
 * raw pipe characters. This splits the question into any introductory
 * text plus a properly parsed table, normalizing that flattening first.
 *
 * Other questions (e.g. "arrange these events in order") embed a lettered
 * sub-list (A. ... B. ... C. ... D. ...) inline in the question text,
 * which the source document shows as separate indented lines but the
 * extraction flattens into one run-on paragraph. This detects that
 * pattern too and renders each item on its own line.
 */
export function renderQuestionContent(text: string): React.ReactNode {
  const tableResult = renderEmbeddedTable(text);
  if (tableResult) return tableResult;

  const listResult = renderEmbeddedLetterList(text);
  if (listResult) return listResult;

  return text;
}

function renderEmbeddedTable(text: string): React.ReactNode | null {
  const firstPipe = text.indexOf('|');
  if (firstPipe === -1) return null;

  const intro = text.slice(0, firstPipe).trim();
  const tablePart = text.slice(firstPipe);

  // Collapse "||" (end of one row immediately followed by start of the
  // next, with no real line break) into a row boundary, so a single-line
  // flattened table parses the same as a properly newlined one.
  const normalized = tablePart.replace(/\|\s*\|/g, '|\n|');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith('|'));

  if (tableLines.length < 2) return null;

  const rows = tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (rows.length < 1) return null;

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div className="space-y-3">
      {intro && <p>{intro}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-slate-300 px-3 py-2 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderEmbeddedLetterList(text: string): React.ReactNode | null {
  // Find markers like "A." / "B)" / "C." preceded by start-of-text or
  // whitespace, so we don't trip on stray letters mid-word.
  const markerPattern = /(?:^|\s)([A-D])[.)]\s+/g;
  const matches: { letter: string; index: number; markerLength: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerPattern.exec(text)) !== null) {
    matches.push({ letter: m[1], index: m.index + m[0].indexOf(m[1]), markerLength: m[0].length - m[0].indexOf(m[1]) });
  }

  if (matches.length < 3) return null;

  // Require the letters found to be a strictly increasing run starting at
  // A (A,B,C or A,B,C,D) — that's the real signal this is a sub-list, not
  // an incidental "A." somewhere in normal prose.
  const letters = matches.map((x) => x.letter);
  const expected = ['A', 'B', 'C', 'D'].slice(0, letters.length);
  if (letters.join('') !== expected.join('')) return null;

  const intro = text.slice(0, matches[0].index).trim();
  const items = matches.map((mm, i) => {
    const start = mm.index + mm.markerLength;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    return { letter: mm.letter, text: text.slice(start, end).trim() };
  });

  return (
    <div className="space-y-2">
      {intro && <p>{intro}</p>}
      <div className="space-y-1.5 pl-1">
        {items.map((item) => (
          <div key={item.letter} className="flex gap-2">
            <span className="font-semibold flex-shrink-0">{item.letter}.</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
