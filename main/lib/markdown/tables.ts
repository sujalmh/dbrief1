/**
 * Table serializers (copy as Markdown / CSV).
 * ===========================================
 * Read a rendered `<table>` element back into Markdown or CSV text for
 * the table copy buttons. Pure DOM reads — no framework, no deps.
 */

function cellText(cell: Element): string {
    return (cell.textContent ?? "").trim().replace(/\s+/g, " ");
}

function tableRows(table: HTMLTableElement): string[][] {
    return Array.from(table.rows).map((row) =>
        Array.from(row.cells).map((cell) => cellText(cell))
    );
}

function escapeCsvCell(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize a rendered table back to a GFM markdown table. */
export function serializeTableElementToMarkdown(table: HTMLTableElement): string {
    const rows = tableRows(table);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (row: string[]): string[] => {
        const out = [...row];
        while (out.length < width) out.push("");
        return out;
    };
    const head = pad(rows[0] ?? []);
    const lines = [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...rows.slice(1).map((row) => `| ${pad(row).join(" | ")} |`),
    ];
    return lines.join("\n");
}

/** Serialize a rendered table to CSV (commas quoted per RFC 4180). */
export function serializeTableElementToCsv(table: HTMLTableElement): string {
    return tableRows(table)
        .map((row) => row.map(escapeCsvCell).join(","))
        .join("\n");
}
