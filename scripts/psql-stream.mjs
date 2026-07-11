#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";

export function runPsql(dbUrl, args, opts = {}) {
  const result = spawnSync("psql", [dbUrl, ...args], {
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`psql ${args.join(" ")} failed with exit ${result.status}`);
  }
}

export function runCapture(dbUrl, sql) {
  const result = spawnSync("psql", [dbUrl, "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${result.stderr || result.status}`);
  }
  return (result.stdout ?? "").trim();
}

/** Stream COPY ... TO STDOUT into a file (avoids Node ENOBUFS on large exports). */
export function copyQueryToFile(dbUrl, copySql, outFile) {
  const fd = fs.openSync(outFile, "w");
  try {
    const result = spawnSync(
      "psql",
      [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", copySql],
      { stdio: ["ignore", fd, "inherit"], env: process.env },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`COPY export failed with exit ${result.status}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function writableColumns(dbUrl, table) {
  const cols = runCapture(
    dbUrl,
    `SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = '${table}'
       AND is_generated = 'NEVER'`,
  );
  if (!cols) throw new Error(`No writable columns found for public.${table}`);
  return cols;
}

/**
 * Copy table rows via psql COPY (works across Postgres major versions; pg_dump 16 cannot dump PG 17).
 * Uses FORCE_QUOTE * so jsonb/text fields with commas import correctly.
 */
export function copyTableData(sourceUrl, targetUrl, table) {
  const cols = writableColumns(sourceUrl, table);
  const csvFile = `${table}.csv`;
  const exportOpts = "FORMAT csv, FORCE_QUOTE *";
  const importOpts = "FORMAT csv";

  copyQueryToFile(
    sourceUrl,
    `COPY (SELECT ${cols} FROM public.${table}) TO STDOUT WITH (${exportOpts})`,
    csvFile,
  );

  if (!fs.existsSync(csvFile) || fs.statSync(csvFile).size === 0) {
    try {
      fs.unlinkSync(csvFile);
    } catch {
      // ignore
    }
    console.warn(`Skipping ${table}: no rows on source.`);
    return;
  }

  const importSql = [
    `TRUNCATE public.${table} RESTART IDENTITY CASCADE;`,
    `CREATE TEMP TABLE ${table}_import AS SELECT ${cols} FROM public.${table} LIMIT 0;`,
    `\\copy ${table}_import (${cols}) FROM '${csvFile.replace(/'/g, "''")}' WITH (${importOpts})`,
    `INSERT INTO public.${table} (${cols}) SELECT ${cols} FROM ${table}_import;`,
  ].join("\n");

  const sqlFile = `${table}_import.sql`;
  fs.writeFileSync(sqlFile, importSql);
  try {
    runPsql(targetUrl, ["-v", "ON_ERROR_STOP=1", "-f", sqlFile]);
  } finally {
    for (const f of [csvFile, sqlFile]) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
}
