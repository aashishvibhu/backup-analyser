import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let sql: Promise<SqlJsStatic> | undefined;

/** Loads the SQLite WASM engine once, from our own bundle (no CDN, nothing leaves the browser). */
export function loadSqlJs(): Promise<SqlJsStatic> {
  sql ??= initSqlJs({ locateFile: () => wasmUrl });
  return sql;
}
