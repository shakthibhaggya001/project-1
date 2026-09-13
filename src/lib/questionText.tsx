import React from 'react';

/**
 * Some AI-extracted questions embed their own table directly in the
 * question text (e.g. matching-pairs questions: "Match column A to column
 * B"), rather than as a group-level shared context. The extraction model
 * sometimes flattens the table onto one line using "||" between rows
 * instead of real line breaks, which would otherwise render as a wall of
 * raw pipe characters. This splits the question into any introductory
 * text plus a properly parsed table, normalizing that flattening first.
 */
export function renderQuestionContent(text: string): React.ReactNode {
  const firstPipe = text.indexOf('|');
  if (firstPipe === -1) return text;

  const intro = text.slice(0, firstPipe).trim();
  const tablePart = text.slice(firstPipe);

  // Collapse "||" (end of one row immediately followed by start of the
  // next, with no real line break) into a row boundary, so a single-line
  // flattened table parses the same as a properly newlined one.
  const normalized = tablePart.replace(/\|\s*\|/g, '|\n|');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith('|'));

  if (tableLines.length < 2) return text;

  const rows = tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (rows.length < 1) return text;

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
