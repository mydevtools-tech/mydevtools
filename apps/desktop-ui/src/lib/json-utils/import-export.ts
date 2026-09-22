/**
 * Import/Export utilities for JSON Editor
 */
import { downloadFile } from "@/lib/desktop/save-file"

/**
 * Load JSON from a file
 */
export async function importJSONFromFile(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json,text/plain';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const text = await file.text();
                resolve(text);
            } catch (err) {
                reject(err);
            }
        };

        input.oncancel = () => {
            reject(new Error('File selection cancelled'));
        };

        input.click();
    });
}

/**
 * Export JSON to a file
 */
export function exportJSONToFile(content: string, filename = 'data.json') {
    downloadFile(content, filename, 'application/json');
}

/**
 * Export JSON as CSV (for arrays of objects)
 */
export function exportJSONAsCSV(content: string, filename = 'data.csv'): { success: boolean; error?: string } {
    try {
        const data = JSON.parse(content);

        // Check if it's an array of objects
        if (!Array.isArray(data) || data.length === 0) {
            return { success: false, error: 'CSV export requires an array of objects' };
        }

        if (!data.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
            return { success: false, error: 'CSV export requires an array of objects (not primitives or arrays)' };
        }

        // Get all unique keys
        const allKeys = new Set<string>();
        data.forEach(item => {
            Object.keys(item).forEach(key => allKeys.add(key));
        });
        const columns = Array.from(allKeys);

        // Create CSV content
        const csv = [
            columns.join(','),
            ...data.map(row =>
                columns.map(col => {
                    const val = row[col];
                    const str = val === null || val === undefined ? '' : String(val);
                    // Escape quotes and wrap in quotes if contains comma or quote
                    return str.includes(',') || str.includes('"') || str.includes('\n')
                        ? `"${str.replace(/"/g, '""')}"`
                        : str;
                }).join(',')
            ),
        ].join('\n');

        downloadFile(csv, filename, 'text/csv');

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Failed to export CSV'
        };
    }
}

/**
 * Import CSV and convert to JSON
 */
export async function importCSVFromFile(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const text = await file.text();
                const json = csvToJSON(text);
                resolve(json);
            } catch (err) {
                reject(err);
            }
        };

        input.oncancel = () => {
            reject(new Error('File selection cancelled'));
        };

        input.click();
    });
}

/**
 * Convert CSV text to JSON
 */
function csvToJSON(csv: string): string {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = parseCSVLine(lines[0]);
    const data = lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj: Record<string, any> = {};

        headers.forEach((header, index) => {
            let value: any = values[index] || '';

            // Try to parse as number
            if (value && !isNaN(Number(value))) {
                value = Number(value);
            }
            // Try to parse as boolean
            else if (value === 'true') {
                value = true;
            } else if (value === 'false') {
                value = false;
            } else if (value === 'null' || value === '') {
                value = null;
            }

            obj[header] = value;
        });

        return obj;
    });

    return JSON.stringify(data, null, 2);
}

/**
 * Parse a CSV line (handles quoted values)
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    // Push last field
    result.push(current);

    return result;
}
